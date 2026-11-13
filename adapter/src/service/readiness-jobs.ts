/**
 * The needs that are jobs (`readiness.ts`). The service ranks on its own when the keyed shortlist ask finds a ranking due
 * (`ranking/jobs.ts`), and anyone may run the rank command; the mark is the last try (ranking-attempt.json) and the `ranAt`
 * of the last ranking.json. The weekly shortlist is asked for by chatter's adapter on its heartbeat, so its mark is the
 * last call that carried the adapter key, kept in memory since the service started.
 * Drafting and publishing run in this service; what they last did is kept on each draft in shortlist.json.
 */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { HEARTBEAT_MS } from "../adapter/index.js";
import { PR_OPEN_FAILED, WRITE_FAILED } from "../publish/jobs.js";
import { FRESH_MS } from "../ranking/jobs.js";
import type { DraftState, ShortlistState } from "../shortlist/state.js";
import { currentWeek } from "../shortlist/schedule.js";
import { MERGE_FAILED } from "./draft-routes.js";
import { chosenOff, failing, type Facts, fileProblem, folderProblem, more, type Need, notSetUp, programProblem, type Reading, short, timeOf, working } from "./readiness-reading.js";
import { RANK } from "./readiness-settings.js";

const DAY_MS = 24 * 60 * 60_000;
/** A ranking older than this is stale: a week's shortlist would be made from it. */
export const RANKING_STALE_MS = 8 * DAY_MS;
/** Two heartbeats with no call is late; three is a heartbeat that stopped. */
export const SHORTLIST_DUE_MS = 2 * HEARTBEAT_MS, SHORTLIST_STALE_MS = 3 * HEARTBEAT_MS;
/** How long a week's cards may wait to be posted once its shortlist is made: three heartbeats. */
export const POST_WITHIN_MS = 3 * HEARTBEAT_MS;
/** Beyond the writer's own time limits: the stack map, the screenshots and the checks. */
export const DRAFT_MARGIN_MS = 15 * 60_000;

const job = { kind: "job", required: false, spends: "none" } as const;
const iso = (ms: number) => new Date(ms).toISOString();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const SHORTLIST_UNREAD = "shortlist.json in the data folder cannot be read as ghostpen's shortlist file";
const RANK_FAILED_FIX = `Read the last try on ghostpen's app page and correct what it says; ghostpen tries again an hour after a failed try, or run ${RANK}.`;
const add = (block: string, page: string) => `Add ${block} to ghostpen's kept settings (adapter/docs/${page}.md), then restart ghostpen's service.`;

/** Every draft kept, in every week. */
const draftsOf = (state: ShortlistState): DraftState[] =>
  Object.values(state.weeks).flatMap((week) => week.items.flatMap((item) => (item.draft ? [item.draft] : [])));
/** The earliest of the drafts' times, for a failing's `since`. */
const earliest = (drafts: DraftState[], f: Facts) => Math.min(...drafts.map((d) => timeOf(d.at) ?? f.now.getTime()));

async function rankingReading(f: Facts): Promise<Reading> {
  if (f.settings.sources.topics.length === 0) return notSetUp("sources.topics is empty, so nothing is ranked", f);
  if (f.settings.scorer === undefined) return chosenOff("scorer is not set, so nothing is ranked", f);
  const [kept, tried] = await Promise.all([f.ranking(), f.attempt()]);
  const at = kept.state === "ok" ? timeOf(kept.value.ranAt) : undefined;
  if (tried.state === "bad") return failing("ranking-attempt.json in the data folder cannot be read as ghostpen's record of a ranking try", f.now.getTime());
  const tryAt = tried.state === "ok" ? timeOf(tried.value.startedAt) : undefined;
  // A try's problem is never said here: it can hold a path or a scorer's words. The app page shows it.
  if (tryAt !== undefined && tried.state === "ok" && tryAt > (at ?? Number.NEGATIVE_INFINITY)) {
    if (tried.value.outcome === "failed") return failing(`the ranking tried at ${iso(tryAt)} failed`, tryAt, RANK_FAILED_FIX);
    // A try left running by a service that stopped reads as the rest of this list once it is a day old.
    if (tried.value.outcome === "running" && f.now.getTime() - tryAt <= FRESH_MS) return working(`a ranking started at ${iso(tryAt)}`, tryAt);
  }
  const unset = f.settings.shortlist === undefined ? "shortlist" : f.settings.adapterKeyFile === undefined ? "adapterKeyFile" : undefined;
  const asks = unset ? `; ${unset} is not set, so nothing asks for the shortlist and no ranking starts on its own` : "";
  if (kept.state === "none") return short(`no ranking has run yet${asks}`, f, RANKING_STALE_MS);
  if (at === undefined) return failing("ranking.json in the data folder cannot be read as a ranking ghostpen wrote", f.now.getTime());
  if (f.now.getTime() - at > RANKING_STALE_MS) return failing(`the last ranking ran at ${iso(at)}, over 8 days ago${asks}`, at + RANKING_STALE_MS);
  return working(`the last ranking ran at ${iso(at)}${asks}`, at);
}

async function shortlistReading(f: Facts): Promise<Reading> {
  const { shortlist } = f.settings;
  if (shortlist === undefined) return notSetUp("shortlist is not set, so no shortlist is posted", f);
  if (f.settings.adapterKeyFile === undefined) return notSetUp("adapterKeyFile is not set, so chatter's adapter cannot ask for the shortlist", f);
  const last = f.lastKeyedCall?.getTime();
  if (last === undefined) return short("chatter's adapter has not asked for the shortlist since the service started", f, SHORTLIST_DUE_MS);
  if (f.now.getTime() - last > SHORTLIST_STALE_MS) return failing(`chatter's adapter last asked at ${iso(last)}, over 30 minutes ago`, last + SHORTLIST_STALE_MS);
  const kept = await f.shortlists();
  if (kept.state === "bad") return failing(SHORTLIST_UNREAD, f.now.getTime());
  const week = kept.state === "ok" ? kept.value.weeks[currentWeek(shortlist, f.now)] : undefined;
  const made = timeOf(week?.madeAt);
  const unposted = week?.items.filter((item) => item.posted === undefined).length ?? 0;
  if (week !== undefined && unposted > 0 && (made === undefined || f.now.getTime() - made > POST_WITHIN_MS)) {
    return failing(`${unposted} of this week's ${week.items.length} cards ${unposted === 1 ? "is" : "are"} not posted 30 minutes after the shortlist was made`,
      made === undefined ? f.now.getTime() : made + POST_WITHIN_MS, "Look at chatter's log for ghostpen's lines and check ghostpen's channel; restarting chatter restarts the adapter's heartbeat.");
  }
  return working(`chatter's adapter last asked at ${iso(last)}`, last);
}

async function draftingReading(f: Facts): Promise<Reading> {
  const { draft } = f.settings;
  if (draft === undefined) return chosenOff("draft is not set, so a Write is kept and nothing is drafted", f);
  const problems = (await Promise.all([
    programProblem(draft.writer.command[0]!).then((p) => p && `draft.writer.command[0]: ${p}`),
    draft.stackMap ? programProblem(draft.stackMap.command[0]!).then((p) => p && `draft.stackMap.command[0]: ${p}`) : undefined,
    draft.styleGuide ? fileProblem(draft.styleGuide, constants.R_OK).then((p) => p && `draft.styleGuide: ${p}`) : undefined,
  ])).filter((p): p is string => p !== undefined);
  if (problems[0] !== undefined) return failing(`${problems[0]}${more(problems.length - 1)}`, f.now.getTime());
  const kept = await f.shortlists();
  if (kept.state === "bad") return failing(SHORTLIST_UNREAD, f.now.getTime());
  const drafts = kept.state === "ok" ? draftsOf(kept.value) : [];
  const stopped = drafts.filter((d) => d.status === "error" && d.problem?.startsWith(WRITE_FAILED));
  if (stopped.length > 0) {
    return failing(`${plural(stopped.length, "draft", "drafts")} stopped because the writer failed; each card says so`, earliest(stopped, f),
      "Press Edit on the draft's card to try again; if it stops again, check draft.writer (adapter/docs/drafting.md).");
  }
  const limit = draft.writer.timeoutSeconds * 1000 * (draft.revisions + 1) + DRAFT_MARGIN_MS;
  const stuck = drafts.filter((d) => (d.status === "queued" || d.status === "drafting") && f.now.getTime() - (timeOf(d.at) ?? 0) > limit);
  if (stuck.length > 0) {
    return failing(`${plural(stuck.length, "draft has", "drafts have")} been waiting or drafting for over ${Math.round(limit / 60_000)} minutes`,
      earliest(stuck, f), "Restart ghostpen's service, which takes up again the drafts it was in the middle of.");
  }
  return working("the writer can be run and no draft stopped", f.started.getTime());
}

async function publishingReading(f: Facts): Promise<Reading> {
  const { publish } = f.settings;
  if (publish === undefined) return chosenOff("publish is not set, so drafts stay in ghostpen", f);
  if (f.settings.draft === undefined) return notSetUp("draft is not set, so nothing is drafted to publish", f);
  const repo = await folderProblem(publish.repoDir, constants.R_OK | constants.W_OK | constants.X_OK);
  const git = repo === undefined ? await access(join(publish.repoDir, ".git")).then(() => undefined, () => "it holds no .git") : repo;
  const problems = (await Promise.all([
    Promise.resolve(git && `publish.repoDir: ${git}`),
    programProblem("git").then((p) => p && `git: ${p}`),
    programProblem("gh").then((p) => p && `gh: ${p}`),
    publish.reviewCommand ? programProblem(publish.reviewCommand[0]!).then((p) => p && `publish.reviewCommand[0]: ${p}`) : undefined,
  ])).filter((p): p is string => p !== undefined);
  if (problems[0] !== undefined) return failing(`${problems[0]}${more(problems.length - 1)}`, f.now.getTime());
  const kept = await f.shortlists();
  if (kept.state === "bad") return failing(SHORTLIST_UNREAD, f.now.getTime());
  const refused = (kept.state === "ok" ? draftsOf(kept.value) : [])
    .filter((d) => d.problem !== undefined && (d.problem.startsWith(PR_OPEN_FAILED) || d.problem.startsWith(MERGE_FAILED)));
  if (refused.length > 0) {
    return failing(`${plural(refused.length, "draft", "drafts")} could not open a pull request or merge; each card says why`, earliest(refused, f),
      "Read the draft's card, then press Edit or Publish again; if it fails again, check publish (adapter/docs/publishing.md).");
  }
  return working("the blog's clone, git and gh are there and no draft failed to publish", f.started.getTime());
}

export const JOB_NEEDS: Need[] = [
  { ...job, id: "ranking", label: "Topic ranking", fix: `ghostpen ranks on its own when chatter's adapter asks for the weekly shortlist (adapter/docs/ranking.md); to rank now, run ${RANK} on ghostpen's host.`, check: rankingReading },
  { ...job, id: "weekly-shortlist", label: "Weekly shortlist", fix: add("shortlist and adapterKeyFile", "shortlist"), check: shortlistReading },
  { ...job, id: "drafting", label: "Drafting", spends: "usage", fix: add("draft", "drafting"), check: draftingReading },
  { ...job, id: "publishing", label: "Publishing", spends: "usage", fix: add("publish", "publishing"), check: publishingReading },
];
