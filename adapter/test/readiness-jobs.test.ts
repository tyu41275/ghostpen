import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PR_OPEN_FAILED, WRITE_FAILED } from "../src/publish/jobs.js";
import { RANKING_FILE } from "../src/ranking/run.js";
import { MERGE_FAILED } from "../src/service/draft-routes.js";
import { RANKING_STALE_MS, SHORTLIST_DUE_MS, SHORTLIST_STALE_MS } from "../src/service/readiness-jobs.js";
import { currentWeek } from "../src/shortlist/schedule.js";
import { SHORTLIST_FILE, saveShortlists, type DraftState, type WeekItem } from "../src/shortlist/state.js";
import { after, bare, folder, installed, MINUTE, programIn, STARTED } from "./readiness-seed.js";
import { tempDir } from "./helpers.js";

afterEach(() => { vi.unstubAllEnvs(); });
const DAY = 24 * 60 * MINUTE;
const sh = () => join(programIn("run"), "run");
const ranked = (extra: Record<string, unknown> = {}) => installed({ sources: { topics: [{ name: "notes", kind: "markdown", root: folder(), include: ["*.md"] }] },
  scorer: { command: [sh()] }, ...extra });
const rankedAt = (dataDir: string, at: Date) =>
  writeFileSync(join(dataDir, RANKING_FILE), JSON.stringify({ ranAt: at.toISOString(), entries: [], background: [], owed: [], problems: [] }));
const item = (over: Partial<WeekItem> = {}): WeekItem => ({ id: "a", kind: "decision", text: "A", ...over });
const week = (dataDir: string, madeAt: Date, items: WeekItem[], key = currentWeek({ day: "monday", time: "09:00", timeZone: "UTC" }, madeAt)) =>
  saveShortlists(dataDir, { version: 1, weeks: { [key]: { madeAt: madeAt.toISOString(), items } } });
const drafted = (draft: Partial<DraftState>) => item({ draft: { status: "ready", round: 1, at: after(0).toISOString(), ...draft } });

describe("ranking", () => {
  it("reads not_set_up with no topics and chosen off with no scorer", async () => {
    expect((await installed().read("ranking")).state).toBe("not_set_up");
    expect((await installed({ sources: { topics: [{ name: "notes", kind: "markdown", root: folder(), include: ["*.md"] }] } }).read("ranking")).state).toBe("chosen_off");
  });

  it("is short of data until 8 days after the service started, naming the rank command and that nothing schedules it", async () => {
    const read = await ranked().read("ranking");
    expect(read).toMatchObject({ state: "short_of_data", since: STARTED.toISOString(), expected_by: after(RANKING_STALE_MS).toISOString() });
    expect(read.fix).toContain("node dist/cli/rank.js <settings>");
    expect(read.fix).toContain("nothing schedules");
  });

  it("reads working since its ranAt, then failing 8 days on", async () => {
    const world = ranked(), at = after(0);
    rankedAt(world.dataDir, at);
    expect(await world.read("ranking", { now: after(RANKING_STALE_MS) })).toMatchObject({ state: "working", since: at.toISOString() });
    expect(await world.read("ranking", { now: after(RANKING_STALE_MS + 1) })).toMatchObject({ state: "failing", since: after(RANKING_STALE_MS).toISOString(),
      why: `the last ranking ran at ${at.toISOString()}, over 8 days ago` });
  });

  it("reads failing on a ranking.json that is not one ghostpen wrote", async () => {
    const world = ranked();
    for (const text of ["not json", JSON.stringify({ ranAt: "/private/x", entries: [], background: [], owed: [], problems: [] }), JSON.stringify({ ranAt: "x" })]) {
      writeFileSync(join(world.dataDir, RANKING_FILE), text);
      const read = await world.read("ranking");
      expect(read).toMatchObject({ state: "failing", why: "ranking.json in the data folder cannot be read as a ranking ghostpen wrote" });
    }
  });
});

describe("weekly-shortlist", () => {
  const set = { shortlist: { operator: "12345" } };

  it("reads not_set_up with no shortlist or no adapter key", async () => {
    expect(await installed().read("weekly-shortlist")).toMatchObject({ state: "not_set_up", why: expect.stringContaining("shortlist is not set") });
    expect(await bare(set)("weekly-shortlist")).toMatchObject({ state: "not_set_up", why: expect.stringContaining("adapterKeyFile") });
  });

  it("is short of data until two heartbeats after the start with no keyed call", async () => {
    expect(await installed(set).read("weekly-shortlist")).toMatchObject({ state: "short_of_data", expected_by: after(SHORTLIST_DUE_MS).toISOString() });
    expect(SHORTLIST_DUE_MS).toBe(20 * MINUTE);
  });

  it("reads working since the last keyed call, failing once it is over 30 minutes old", async () => {
    const world = installed(set), call = after(MINUTE);
    expect(await world.read("weekly-shortlist", { now: after(5 * MINUTE), lastKeyedCall: call })).toMatchObject({ state: "working", since: call.toISOString() });
    expect(SHORTLIST_STALE_MS).toBe(30 * MINUTE);
    expect(await world.read("weekly-shortlist", { now: after(31 * MINUTE + 1), lastKeyedCall: call }))
      .toMatchObject({ state: "failing", since: after(31 * MINUTE).toISOString(), why: `chatter's adapter last asked at ${call.toISOString()}, over 30 minutes ago` });
  });

  it("reads failing when this week's cards are not posted 30 minutes after the shortlist was made", async () => {
    const world = installed(set), made = after(0);
    week(world.dataDir, made, [item(), item({ id: "b", posted: { channelRef: "1", messageRef: "2" } })]);
    const at = (minutes: number) => ({ now: after(minutes * MINUTE), lastKeyedCall: after((minutes - 1) * MINUTE) });
    expect((await world.read("weekly-shortlist", at(30))).state).toBe("working");
    expect(await world.read("weekly-shortlist", at(31))).toMatchObject({ state: "failing", since: after(30 * MINUTE).toISOString(),
      why: "1 of this week's 2 cards is not posted 30 minutes after the shortlist was made" });
    week(world.dataDir, made, [item({ posted: { channelRef: "1", messageRef: "2" } })]);
    expect((await world.read("weekly-shortlist", at(31))).state).toBe("working");
    week(world.dataDir, after(-7 * DAY), [item()]);
    expect((await world.read("weekly-shortlist", at(31))).state).toBe("working");
  });

  it("reads failing on a shortlist.json it cannot read", async () => {
    const world = installed(set);
    writeFileSync(join(world.dataDir, SHORTLIST_FILE), "{ private");
    expect(await world.read("weekly-shortlist", { lastKeyedCall: after(0) })).toMatchObject({ state: "failing", why: expect.stringContaining("shortlist.json") });
  });
});

describe("drafting", () => {
  const writer = () => ({ draft: { writer: { command: [sh()], timeoutSeconds: 60 }, revisions: 1 } });

  it("is chosen off with no draft, working with a writer that runs and drafts ready, held or failed", async () => {
    expect((await installed().read("drafting")).state).toBe("chosen_off");
    const world = installed(writer());
    week(world.dataDir, after(0), [drafted({ status: "ready" }), drafted({ status: "held" }), drafted({ status: "failed" })]);
    expect((await world.read("drafting")).state).toBe("working");
  });

  it("names the writer, the stack map or the style guide that cannot be used", async () => {
    const gone = join(tempDir(), "gone");
    expect(await installed({ draft: { writer: { command: [gone] } } }).read("drafting")).toMatchObject({ state: "failing", why: "draft.writer.command[0]: the file is missing" });
    expect(await installed({ draft: { writer: { command: [sh()] }, stackMap: { command: [gone] }, styleGuide: gone } }).read("drafting"))
      .toMatchObject({ state: "failing", why: "draft.stackMap.command[0]: the file is missing (and 1 more)" });
  });

  it("counts drafts the writer stopped on, quoting none of their problems", async () => {
    const world = installed(writer());
    week(world.dataDir, after(0), [drafted({ status: "error", problem: `${WRITE_FAILED}/private/writer died` }), drafted({ status: "error", problem: `${PR_OPEN_FAILED}x` })]);
    expect(await world.read("drafting")).toMatchObject({ state: "failing", since: after(0).toISOString(), why: "1 draft stopped because the writer failed; each card says so" });
  });

  it("reads failing on a draft waiting or drafting past the writer's time limits and a margin", async () => {
    const world = installed(writer()), limit = 60_000 * 2 + 15 * MINUTE;
    week(world.dataDir, after(0), [drafted({ status: "drafting" }), drafted({ status: "queued" })]);
    expect((await world.read("drafting", { now: after(limit) })).state).toBe("working");
    expect(await world.read("drafting", { now: after(limit + 1) })).toMatchObject({ state: "failing", why: "2 drafts have been waiting or drafting for over 17 minutes" });
  });
});

describe("publishing", () => {
  const tools = () => { const dir = programIn("git"); programIn("gh", 0o755, dir); vi.stubEnv("PATH", dir); };
  const repo = () => { const dir = tempDir(); mkdirSync(join(dir, ".git")); return dir; };
  const publishing = (repoDir = repo(), extra: Record<string, unknown> = {}) =>
    installed({ draft: { writer: { command: [sh()] } }, publish: { repoDir, repo: "owner/blog", ...extra } });

  it("is chosen off with no publish, and not_set_up with no draft", async () => {
    expect((await installed().read("publishing")).state).toBe("chosen_off");
    expect((await installed({ publish: { repoDir: repo(), repo: "owner/blog" } }).read("publishing")).state).toBe("not_set_up");
  });

  it("reads working on a clone with .git, git and gh on PATH, and the review program", async () => {
    tools();
    expect((await publishing(repo(), { reviewCommand: [sh(), "{pr}"] }).read("publishing")).state).toBe("working");
  });

  it("names the clone, the tool or the review program that is not there", async () => {
    tools();
    expect(await publishing(join(tempDir(), "gone")).read("publishing")).toMatchObject({ state: "failing", why: "publish.repoDir: the folder is missing" });
    expect(await publishing(tempDir()).read("publishing")).toMatchObject({ state: "failing", why: "publish.repoDir: it holds no .git" });
    expect(await publishing(repo(), { reviewCommand: ["no-such-review"] }).read("publishing")).toMatchObject({ why: "publish.reviewCommand[0]: it is not found on PATH" });
    vi.stubEnv("PATH", programIn("git"));
    expect(await publishing().read("publishing")).toMatchObject({ state: "failing", why: "gh: it is not found on PATH" });
  });

  it("counts drafts whose pull request did not open or whose merge failed, quoting none", async () => {
    tools();
    const world = publishing();
    week(world.dataDir, after(0), [drafted({ status: "error", problem: `${PR_OPEN_FAILED}gh pr failed: /private` }),
      drafted({ status: "ready", problem: `${MERGE_FAILED}gh pr failed: private` }), drafted({ status: "error", problem: `${WRITE_FAILED}x` })]);
    const read = await world.read("publishing");
    expect(read).toMatchObject({ state: "failing", why: "2 drafts could not open a pull request or merge; each card says why" });
    expect(read.why).not.toContain("private");
  });
});
