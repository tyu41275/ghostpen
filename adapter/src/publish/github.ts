/**
 * A draft becomes a blog pull request, and Publish lands it (ghostpen#90, ADR 0101 amended 2026-10-25). ghostpen works
 * in its own clone of the blog repo (`publish.repoDir`; nothing else edits it): one branch per post, the post file and
 * its screenshots, a pull request carrying the check report and preview link. The operator's independent review
 * (`publish.reviewCommand`) starts as the pull request opens. Publish merges only when the review's status
 * (`publish.reviewStatus`) has passed and no other check is failing or still running; it says which, in plain words,
 * otherwise. Nothing merges without the operator's press.
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runIn, type Run } from "../command.js";
import { reportText } from "../draft/checks.js";
import type { Draft } from "../draft/write.js";
import { postText, slugOf } from "./post.js";

export interface PublishSettings {
  /** ghostpen's own clone of the blog repo (absolute); it checks out branches there. */
  repoDir: string;
  /** The blog repo as `owner/name`. */
  repo: string;
  base: string;
  /** Where posts go, relative to the repo (default `data/blog`). */
  postsDir: string;
  /** Where screenshots go, relative to the repo (default `public/static/images/ghostpen`), one folder per post. */
  imagesDir: string;
  /** Where the blog serves `imagesDir` (default `/static/images/ghostpen`). */
  imagesUrl: string;
  /** The preview address, `{branch}` replaced by the branch with every `/` made `-`; unset: no preview link. */
  previewUrl?: string;
  /** The independent review, an argv with `{repo}`, `{pr}`, `{dir}` and `{round}` filled in; unset: no review is started. */
  reviewCommand?: string[];
  /** The status the review posts, which must pass before Publish (default `independent-review`). */
  reviewStatus: string;
}

/** `head`: the commit ghostpen pushed; Publish merges only that commit, so a review of an earlier draft never counts. */
export interface PostPr { number: number; url: string; branch: string; head: string; preview?: string }

export const branchOf = (draft: Draft) => `ghostpen/${slugOf(draft.title)}`;

function previewOf(settings: PublishSettings, branch: string): string | undefined {
  return settings.previewUrl?.replace("{branch}", branch.replace(/\//gu, "-"));
}

function prBody(draft: Draft, preview: string | undefined): string {
  return [draft.summary, "", preview ? `Preview: ${preview}` : "No preview address is configured.", "",
    "Checks:", "```", reportText(draft.report), "```", "",
    "Drafted by ghostpen. Nothing merges until the author presses Publish, after the independent review approves."].join("\n");
}

/**
 * Opens (or updates) the post's pull request. `date` is the post date (YYYY-MM-DD). `branch`: an edited draft keeps
 * its first branch, and so its pull request, even when its title changed.
 */
export async function openPostPr(settings: PublishSettings, draft: Draft, date: string, run: Run = runIn, branch = branchOf(draft)): Promise<PostPr> {
  const cwd = settings.repoDir;
  const slug = slugOf(draft.title);
  await run(["git", "fetch", "origin", settings.base], { cwd });
  await run(["git", "checkout", "-f", "-B", branch, `origin/${settings.base}`], { cwd });
  const file = join(settings.postsDir, `${slug}.mdx`);
  mkdirSync(join(cwd, settings.postsDir), { recursive: true });
  writeFileSync(join(cwd, file), postText(draft, date, slug, settings.imagesUrl));
  const paths = [file];
  for (const [name, png] of Object.entries(draft.screenshots ?? {})) {
    const target = join(settings.imagesDir, slug, `${name}.png`);
    mkdirSync(join(cwd, settings.imagesDir, slug), { recursive: true });
    copyFileSync(png, join(cwd, target));
    paths.push(target);
  }
  await run(["git", "add", "--", ...paths], { cwd });
  await run(["git", "commit", "-m", `Post: ${draft.title} (drafted by ghostpen)`], { cwd });
  const head = (await run(["git", "rev-parse", "HEAD"], { cwd })).trim();
  await run(["git", "push", "-f", "origin", branch], { cwd });
  const preview = previewOf(settings, branch);
  const open = JSON.parse(await run(["gh", "pr", "list", "-R", settings.repo, "--head", branch, "--state", "open", "--json", "number,url"], { cwd })) as Array<{ number: number; url: string }>;
  if (open[0]) {
    await run(["gh", "pr", "edit", String(open[0].number), "-R", settings.repo, "--title", `Post: ${draft.title}`, "--body", prBody(draft, preview)], { cwd });
    return { number: open[0].number, url: open[0].url, branch, head, ...(preview ? { preview } : {}) };
  }
  const url = (await run(["gh", "pr", "create", "-R", settings.repo, "--base", settings.base, "--head", branch, "--title", `Post: ${draft.title}`,
    "--body", prBody(draft, preview)], { cwd })).trim().split("\n").pop()!;
  const number = Number(/\/pull\/(\d+)/u.exec(url)?.[1]);
  if (!number) throw new Error("gh did not say which pull request it opened");
  return { number, url, branch, head, ...(preview ? { preview } : {}) };
}

/** Starts the operator's review of pull request `pr`, detached; its output goes to `logFile`. Unset: nothing starts. */
export function startReview(settings: PublishSettings, pr: number, round: number, logFile: string): boolean {
  if (!settings.reviewCommand) return false;
  const fill = (arg: string) => arg.replace("{repo}", settings.repo).replace("{pr}", String(pr)).replace("{dir}", settings.repoDir).replace("{round}", String(round));
  const [command, ...args] = settings.reviewCommand.map(fill);
  const out = openSync(logFile, "a");
  const child = spawn(command!, args, { cwd: settings.repoDir, detached: true, stdio: ["ignore", out, out] });
  child.on("error", () => { /* reported by the review's missing status */ });
  child.unref();
  return true;
}

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RUNNING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

interface Rollup { __typename?: string; context?: string; name?: string; state?: string; status?: string; conclusion?: string }
interface PrView { state: string; headRefOid?: string; statusCheckRollup: Rollup[] }

/** Why pull request `pr` cannot be published yet, in plain words, or null when it can. */
export function notReady(view: PrView, reviewStatus: string): string | null {
  if (view.state === "MERGED") return "it is published already";
  if (view.state !== "OPEN") return "its pull request is closed";
  const checks = view.statusCheckRollup.map((c) => ({ name: c.context ?? c.name ?? "a check",
    result: c.__typename === "CheckRun" ? (c.status !== "COMPLETED" ? "PENDING" : (c.conclusion ?? "")) : (c.state ?? "") }));
  const review = checks.find((c) => c.name === reviewStatus);
  if (!review) return "the independent review has not reported yet";
  if (review.result === "PENDING" || review.result === "EXPECTED") return "the independent review is still running";
  if (review.result !== "SUCCESS") return "the independent review asked for changes; press Edit to make them";
  // Only a known good result passes; anything else (a failure, a check that failed at startup, a stale or unknown
  // result) blocks, so a result GitHub adds later never slips through.
  const running = checks.filter((c) => RUNNING.has(c.result)).map((c) => c.name);
  const failing = checks.filter((c) => !RUNNING.has(c.result) && !PASSED.has(c.result)).map((c) => c.name);
  if (failing.length) return `these checks did not pass: ${failing.join(", ")}`;
  if (running.length) return `these checks are still running: ${running.join(", ")}`;
  return null;
}

/**
 * Whether pull request `pr` can be published: null when it can, else why not; `merged` when it is on the blog already.
 * Its head must be `head`, the commit ghostpen pushed for the current draft: statuses belong to a commit, so the review
 * read is that draft's own, never an earlier draft's.
 */
export async function checkPost(settings: PublishSettings, pr: number, head: string, run: Run = runIn): Promise<{ reason: string | null; merged: boolean }> {
  const view = JSON.parse(await run(["gh", "pr", "view", String(pr), "-R", settings.repo, "--json", "state,headRefOid,statusCheckRollup"], { cwd: settings.repoDir })) as PrView;
  if (view.state === "OPEN" && view.headRefOid !== head) return { reason: "the pull request does not hold the current draft yet (or someone else changed it)", merged: false };
  return { reason: notReady(view, settings.reviewStatus), merged: view.state === "MERGED" };
}

/** Merges pull request `pr` (already checked), then brings the clone back to the base so the new post is indexed. */
export async function mergePost(settings: PublishSettings, pr: number, head: string, run: Run = runIn): Promise<void> {
  const cwd = settings.repoDir;
  // --match-head-commit: GitHub refuses the merge if anything was pushed after the check.
  await run(["gh", "pr", "merge", String(pr), "-R", settings.repo, "--squash", "--delete-branch", "--match-head-commit", head], { cwd });
  await run(["git", "fetch", "origin", settings.base], { cwd });
  await run(["git", "checkout", "-f", "-B", settings.base, `origin/${settings.base}`], { cwd });
}

/** `publish`: `repoDir` and `repo` required; the rest default. */
export function parsePublish(raw: unknown): PublishSettings {
  const fail = (what: string): never => { throw new Error(`settings: publish${what}`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(" must be an object");
  const v = raw as Record<string, unknown>;
  if (typeof v.repoDir !== "string" || !v.repoDir.startsWith("/")) fail(".repoDir must be an absolute path");
  if (typeof v.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(v.repo)) fail(".repo must be owner/name");
  const rel = (value: unknown, field: string, fallback: string) => {
    const s = value ?? fallback;
    if (typeof s !== "string" || !s || s.startsWith("/") || s.split("/").includes("..")) fail(`.${field} must be a folder inside the repo`);
    return s as string;
  };
  const base = v.base ?? "main";
  if (typeof base !== "string" || !/^[A-Za-z0-9._/-]+$/u.test(base)) fail(".base must be a branch name");
  const imagesUrl = v.imagesUrl ?? "/static/images/ghostpen";
  if (typeof imagesUrl !== "string" || !imagesUrl.startsWith("/")) fail(".imagesUrl must start with /");
  if (v.previewUrl !== undefined && (typeof v.previewUrl !== "string" || !/^https:\/\/\S*\{branch\}\S*$/u.test(v.previewUrl))) fail(".previewUrl must be a web address holding {branch}");
  if (v.reviewCommand !== undefined && (!Array.isArray(v.reviewCommand) || v.reviewCommand.length === 0 || !v.reviewCommand.every((a) => typeof a === "string" && a))) {
    fail(".reviewCommand must be a non-empty list of strings");
  }
  const reviewStatus = v.reviewStatus ?? "independent-review";
  if (typeof reviewStatus !== "string" || !reviewStatus.trim()) fail(".reviewStatus must be a status name");
  return { repoDir: v.repoDir as string, repo: v.repo as string, base: base as string, postsDir: rel(v.postsDir, "postsDir", "data/blog"),
    imagesDir: rel(v.imagesDir, "imagesDir", "public/static/images/ghostpen"), imagesUrl: imagesUrl as string, reviewStatus: reviewStatus as string,
    ...(v.previewUrl ? { previewUrl: v.previewUrl as string } : {}), ...(v.reviewCommand ? { reviewCommand: v.reviewCommand as string[] } : {}) };
}
