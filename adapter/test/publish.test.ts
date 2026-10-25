import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIn, type Run } from "../src/command.js";
import { draftFile, type Draft } from "../src/draft/write.js";
import { checkPost, mergePost, notReady, openPostPr, parsePublish, startReview } from "../src/publish/github.js";
import { DraftJobs } from "../src/publish/jobs.js";
import { postText, slugOf } from "../src/publish/post.js";
import { answer } from "../src/service/adapter-routes.js";
import { draftCard, draftEdit, draftPosted, draftPublish } from "../src/service/draft-routes.js";
import { parseSettings, type GhostpenSettings } from "../src/settings.js";
import { readShortlists, saveShortlists, type DraftState } from "../src/shortlist/state.js";
import { tempDir } from "./helpers.js";

const REPORT = { passed: true, grade: 4, hold: [], later: [], checks: [{ name: "Plain words", passed: true, findings: [] }] };
const draft = (over: Partial<Draft> = {}): Draft => ({ id: "d:1", kind: "decision", status: "ready", title: "Why we use one timer", summary: "It's simpler.",
  tags: ["ops"], markdown: "We picked one timer.\n\n![the console](screenshot:console)", report: REPORT, attempts: 1, madeAt: "x", problems: [], screenshots: {}, ...over });
const NOW = new Date("2026-10-26T14:00:00Z");
const OPERATOR = "234652039735541760";

describe("the post file", () => {
  it("names posts by title", () => {
    expect(slugOf("Why We Use ONE timer!")).toBe("why-we-use-one-timer");
    expect(slugOf("Café — déjà vu")).toBe("cafe-deja-vu");
    expect(slugOf("!!!")).toBe("post");
    expect(slugOf("a".repeat(100))).toHaveLength(80);
  });

  it("writes the blog's frontmatter with the AI banner and the post's image addresses", () => {
    expect(postText(draft({ title: "Tim's timer", summary: "One 'quote'." }), "2026-10-26", "tims-timer", "/static/images/ghostpen/")).toBe([
      "---", "title: 'Tim''s timer'", "date: '2026-10-26'", "tags: ['ops']", "draft: false", "aiGenerated: true", "summary: 'One ''quote''.'", "---", "",
      "We picked one timer.\n\n![the console](/static/images/ghostpen/tims-timer/console.png)", ""].join("\n"));
  });
});

describe("settings.publish", () => {
  it("reads defaults and refuses bad fields", () => {
    expect(parsePublish({ repoDir: "/r", repo: "o/blog" })).toEqual({ repoDir: "/r", repo: "o/blog", base: "main", postsDir: "data/blog",
      imagesDir: "public/static/images/ghostpen", imagesUrl: "/static/images/ghostpen", reviewStatus: "independent-review" });
    for (const [raw, error] of [[{ repo: "o/b" }, ".repoDir must be an absolute path"], [{ repoDir: "/r", repo: "x" }, ".repo must be owner/name"],
      [{ repoDir: "/r", repo: "o/b", postsDir: "../x" }, ".postsDir must be a folder inside the repo"], [{ repoDir: "/r", repo: "o/b", imagesDir: "/abs" }, ".imagesDir must be a folder"],
      [{ repoDir: "/r", repo: "o/b", previewUrl: "https://x.example/" }, ".previewUrl must be a web address holding {branch}"],
      [{ repoDir: "/r", repo: "o/b", reviewCommand: [] }, ".reviewCommand must be a non-empty list"], [{ repoDir: "/r", repo: "o/b", base: "a b" }, ".base must be a branch name"],
      [{ repoDir: "/r", repo: "o/b", imagesUrl: "x" }, ".imagesUrl must start with /"], [{ repoDir: "/r", repo: "o/b", reviewStatus: " " }, ".reviewStatus must be a status name"]] as const) {
      expect(() => parsePublish(raw)).toThrow(`settings: publish${error}`);
    }
    expect(parseSettings({ instance: "i", port: 8794, dataDir: "/d", publish: { repoDir: "/r", repo: "o/b" } }).publish?.repo).toBe("o/b");
  });
});

/** A blog repo: a bare remote with one commit on main, and ghostpen's clone of it. */
function blogRepo(): { remote: string; clone: string } {
  const root = tempDir();
  const remote = join(root, "remote.git"), seed = join(root, "seed"), clone = join(root, "clone");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  mkdirSync(seed); git(seed, "init", "-q", "-b", "main"); writeFileSync(join(seed, "README.md"), "blog\n");
  git(seed, "add", "."); git(seed, "commit", "-q", "-m", "seed"); git(seed, "remote", "add", "origin", remote); git(seed, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", remote, clone]);
  git(clone, "config", "user.name", "ghostpen"); git(clone, "config", "user.email", "g@example.com");
  return { remote, clone };
}

describe("the pull request", () => {
  it("puts the post and its screenshots on a branch, pushes it, and opens one pull request", async () => {
    const { remote, clone } = blogRepo();
    const png = join(tempDir(), "console.png");
    writeFileSync(png, "PNG");
    const settings = parsePublish({ repoDir: clone, repo: "o/blog", previewUrl: "https://blog-git-{branch}.example" });
    const gh: string[][] = [];
    const run: Run = async (argv, options) => {
      if (argv[0] !== "gh") return runIn(argv, options);
      gh.push(argv);
      if (argv[2] === "list") return "[]";
      return "https://github.com/o/blog/pull/7\n";
    };
    const pr = await openPostPr(settings, draft({ screenshots: { console: png } }), "2026-10-26", run);
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/blog/pull/7", branch: "ghostpen/why-we-use-one-timer", preview: "https://blog-git-ghostpen-why-we-use-one-timer.example" });
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "ghostpen/why-we-use-one-timer"], { cwd: remote }).toString().trim().split("\n");
    expect(files).toEqual(["README.md", "data/blog/why-we-use-one-timer.mdx", "public/static/images/ghostpen/why-we-use-one-timer/console.png"]);
    const create = gh.find((a) => a[2] === "create")!;
    expect(create.slice(0, 11)).toEqual(["gh", "pr", "create", "-R", "o/blog", "--base", "main", "--head", "ghostpen/why-we-use-one-timer", "--title", "Post: Why we use one timer"]);
    expect(create[12]).toContain("Preview: https://blog-git-ghostpen-why-we-use-one-timer.example");
    expect(create[12]).toContain("✅ Plain words");

    // An edit with a new title keeps the branch and updates the open pull request.
    gh.length = 0;
    const again = await openPostPr(settings, draft({ title: "One timer is enough" }), "2026-10-26",
      async (argv, options) => (argv[0] !== "gh" ? runIn(argv, options) : (gh.push(argv), argv[2] === "list" ? '[{"number":7,"url":"u7"}]' : "")), pr.branch);
    expect(again).toMatchObject({ number: 7, url: "u7", branch: "ghostpen/why-we-use-one-timer" });
    expect(gh.map((a) => a[2])).toEqual(["list", "edit"]);
    expect(gh[1]!.slice(0, 8)).toEqual(["gh", "pr", "edit", "7", "-R", "o/blog", "--title", "Post: One timer is enough"]);
    const after = execFileSync("git", ["ls-tree", "-r", "--name-only", pr.branch], { cwd: remote }).toString();
    expect(after).toContain("data/blog/one-timer-is-enough.mdx");
    expect(after).not.toContain("why-we-use-one-timer.mdx");
  });

  it("starts the review with its placeholders filled, detached, logging to a file", async () => {
    const dir = tempDir();
    const log = join(dir, "review.log");
    const settings = parsePublish({ repoDir: dir, repo: "o/blog", reviewCommand: [process.execPath, "-e", "console.log(process.argv.slice(1).join(' '))", "{repo}", "{pr}", "{round}", "{dir}"] });
    expect(startReview(settings, 7, 2, log)).toBe(true);
    for (let i = 0; i < 50 && !(existsSync(log) && readFileSync(log, "utf8")); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(log, "utf8").trim()).toBe(`o/blog 7 2 ${dir}`);
    expect(startReview(parsePublish({ repoDir: dir, repo: "o/blog" }), 7, 1, log)).toBe(false);
  });
});

describe("Publish", () => {
  const status = (context: string, state: string) => ({ __typename: "StatusContext", context, state });
  const run = (view: unknown, calls: string[][]): Run => async (argv) => { calls.push(argv); return argv[2] === "view" ? JSON.stringify(view) : ""; };

  it("says in plain words why a post can't go out yet", () => {
    const r = "independent-review";
    expect(notReady({ state: "MERGED", statusCheckRollup: [] }, r)).toBe("it is published already");
    expect(notReady({ state: "CLOSED", statusCheckRollup: [] }, r)).toBe("its pull request is closed");
    expect(notReady({ state: "OPEN", statusCheckRollup: [] }, r)).toBe("the independent review has not reported yet");
    expect(notReady({ state: "OPEN", statusCheckRollup: [status(r, "PENDING")] }, r)).toBe("the independent review is still running");
    expect(notReady({ state: "OPEN", statusCheckRollup: [status(r, "FAILURE")] }, r)).toBe("the independent review asked for changes; press Edit to make them");
    expect(notReady({ state: "OPEN", statusCheckRollup: [status(r, "SUCCESS"), { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "FAILURE" }] }, r)).toBe("these checks failed: build");
    expect(notReady({ state: "OPEN", statusCheckRollup: [status(r, "SUCCESS"), { __typename: "CheckRun", name: "vercel", status: "IN_PROGRESS" }] }, r)).toBe("these checks are still running: vercel");
    expect(notReady({ state: "OPEN", statusCheckRollup: [status(r, "SUCCESS"), { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }] }, r)).toBeNull();
  });

  it("checks a pull request, and merges it and brings the clone back to main", async () => {
    const settings = parsePublish({ repoDir: "/r", repo: "o/blog" });
    const calls: string[][] = [];
    expect(await checkPost(settings, 7, run({ state: "OPEN", statusCheckRollup: [status("independent-review", "SUCCESS")] }, calls))).toEqual({ reason: null, merged: false });
    expect(await checkPost(settings, 7, run({ state: "MERGED", statusCheckRollup: [] }, calls))).toEqual({ reason: "it is published already", merged: true });
    expect(calls[0]).toEqual(["gh", "pr", "view", "7", "-R", "o/blog", "--json", "state,statusCheckRollup"]);
    calls.length = 0;
    await mergePost(settings, 7, run({}, calls));
    expect(calls).toEqual([["gh", "pr", "merge", "7", "-R", "o/blog", "--squash", "--delete-branch"], ["git", "fetch", "origin", "main"], ["git", "checkout", "-f", "-B", "main", "origin/main"]]);
  });
});

/** Settings and a week with one Write-able item. */
function service(over: Record<string, unknown> = {}): GhostpenSettings {
  const settings = parseSettings({ instance: "i", port: 8794, dataDir: tempDir(), shortlist: { operator: OPERATOR, channel: "123456" },
    draft: { writer: { command: ["true"] } }, publish: { repoDir: "/r", repo: "o/blog" }, ...over });
  saveShortlists(settings.dataDir, { version: 1, weeks: { "2026-10-26": { madeAt: "x", items: [{ id: "d:1", kind: "decision", text: "**#1 Topic**" }] } } });
  return settings;
}
const draftOf = (settings: GhostpenSettings) => readShortlists(settings.dataDir).weeks["2026-10-26"]!.items[0]!.draft;
const pr = { number: 7, url: "https://github.com/o/blog/pull/7", branch: "ghostpen/x" };

describe("drafting after a Write", () => {
  it("drafts, opens the pull request and starts its review", async () => {
    const settings = service();
    const reviews: unknown[] = [];
    const jobs = new DraftJobs(settings, { draft: async () => draft(), open: async () => pr, review: (_s, n, round) => { reviews.push([n, round]); return true; }, now: () => NOW });
    expect(answer(settings, { week: "2026-10-26", index: 0, action: "write", user: OPERATOR }, NOW, jobs).body.reply).toBe("Drafting it now; the draft comes to this channel when it is ready.");
    expect(draftOf(settings)?.status).toBe("queued");
    await jobs.idle();
    expect(draftOf(settings)).toMatchObject({ status: "ready", round: 1, title: "Why we use one timer", pr });
    expect(draftOf(settings)?.report).toContain("All checks passed.");
    expect(reviews).toEqual([[7, 1]]);
  });

  it("keeps a held or failed draft without a pull request, and a failure to draft or open as an error", async () => {
    for (const [deps, status, problem] of [
      [{ draft: async () => draft({ status: "held" }) }, "held", undefined],
      [{ draft: async () => draft({ status: "failed" }) }, "failed", undefined],
      [{ draft: async () => { throw new Error("the draft writer exited 1\nmore"); } }, "error", "the draft could not be written: the draft writer exited 1"],
      [{ open: async () => { throw new Error("git push failed: denied"); } }, "error", "the pull request could not be opened: git push failed: denied"]] as const) {
      const settings = service();
      let opened = 0;
      const jobs = new DraftJobs(settings, { draft: async () => draft(), open: async () => { opened += 1; return pr; }, review: () => true, now: () => NOW, ...deps });
      answer(settings, { week: "2026-10-26", index: 0, action: "write", user: OPERATOR }, NOW, jobs);
      await jobs.idle();
      expect(draftOf(settings)?.status).toBe(status);
      expect(draftOf(settings)?.problem).toBe(problem);
      if (status !== "error") expect(opened).toBe(0);
    }
  });

  it("keeps a ready draft in ghostpen when no blog repo is set", async () => {
    const settings = service({ publish: undefined });
    const jobs = new DraftJobs(settings, { draft: async () => draft(), open: async () => { throw new Error("never"); }, now: () => NOW });
    answer(settings, { week: "2026-10-26", index: 0, action: "write", user: OPERATOR }, NOW, jobs);
    await jobs.idle();
    expect(draftOf(settings)).toMatchObject({ status: "ready" });
    expect(draftOf(settings)?.pr).toBeUndefined();
  });

  it("drafts nothing without a writer or for a Skip, and picks up unfinished drafts after a restart", async () => {
    const settings = service();
    const idle = new DraftJobs(settings, { draft: async () => { throw new Error("never"); } });
    answer(settings, { week: "2026-10-26", index: 0, action: "later", user: OPERATOR }, NOW, idle);
    expect(draftOf(settings)).toBeUndefined();
    saveShortlists(settings.dataDir, { version: 1, weeks: { "2026-10-26": { madeAt: "x", items: [{ id: "d:1", kind: "decision", text: "**#1 Topic**" }] } } });
    expect(answer(settings, { week: "2026-10-26", index: 0, action: "write", user: OPERATOR }, NOW).body.reply).toBe("Noted. No draft writer is set here (settings.draft), so nothing is drafted.");
    expect(draftOf(settings)).toBeUndefined();
    const state = readShortlists(settings.dataDir);
    state.weeks["2026-10-26"]!.items[0]!.draft = { status: "drafting", round: 1, at: "x" };
    saveShortlists(settings.dataDir, state);
    const jobs = new DraftJobs(settings, { draft: async () => draft({ status: "held" }), now: () => NOW });
    expect(jobs.resume()).toBe(1);
    await jobs.idle();
    expect(draftOf(settings)?.status).toBe("held");
  });
});

describe("the draft's card, Publish and Edit", () => {
  const base: DraftState = { status: "ready", round: 1, title: "T", report: "All checks passed.", pr: { ...pr, preview: "https://p" }, at: "x" };

  it("says what happened in plain words, with the buttons that make sense", () => {
    expect(draftCard({ ...base, status: "drafting" }, "d:1")).toBeNull();
    expect(draftCard(base, "d:1")).toEqual({ publish: true, edit: true,
      text: "**Draft ready: T**\nPull request: https://github.com/o/blog/pull/7\nPreview: https://p\n\nAll checks passed.\n\nPublish puts it on the blog once the independent review approves. Edit sends your changes to the writer." });
    expect(draftCard({ ...base, pr: undefined }, "d:1")).toMatchObject({ publish: false, edit: true });
    expect(draftCard({ ...base, status: "held" }, "d:1")).toMatchObject({ publish: false, edit: false });
    expect(draftCard({ ...base, status: "failed" }, "d:1")).toMatchObject({ publish: false, edit: true });
    expect(draftCard({ status: "error", round: 1, problem: "boom", at: "x" }, "d:1")).toEqual({ publish: false, edit: true, text: "**Drafting stopped: d:1**\nboom\n\nEdit to try again." });
    expect(draftCard({ ...base, status: "published" }, "d:1")).toEqual({ publish: false, edit: false, text: "**Published: T**\nhttps://github.com/o/blog/pull/7" });
    expect(draftCard({ ...base, report: "x".repeat(3000) }, "d:1")!.text.length).toBeLessThanOrEqual(1901);
  });

  function withDraft(d: DraftState): GhostpenSettings {
    const settings = service();
    const state = readShortlists(settings.dataDir);
    state.weeks["2026-10-26"]!.items[0]!.draft = d;
    saveShortlists(settings.dataDir, state);
    return settings;
  }
  const at = { week: "2026-10-26", index: 0 };

  it("keeps where the card went", () => {
    const settings = withDraft(base);
    expect(draftPosted(settings, { ...at, round: 1, status: "ready", channelRef: "c", messageRef: "m" }).status).toBe(200);
    expect(draftOf(settings)?.card).toEqual({ channelRef: "c", messageRef: "m", round: 1, status: "ready" });
    expect(draftPosted(settings, { ...at, channelRef: "c", messageRef: "m" }).status).toBe(400);
    expect(draftPosted(settings, { week: "2026-10-26", index: 5, round: 1, status: "ready", channelRef: "c", messageRef: "m" }).status).toBe(404);
  });

  it("publishes only for the operator, only the newest card's ready draft, only when the pull request is ready, merging in the background", async () => {
    const settings = withDraft(base);
    const clock = () => NOW;
    let merges = 0;
    let finish: (error?: Error) => void = () => {};
    const ops = (check: { reason: string | null; merged: boolean } | Error) => ({
      check: async () => { if (check instanceof Error) throw check; return check; },
      merge: () => { merges += 1; return new Promise<void>((resolve, reject) => { finish = (e) => (e ? reject(e) : resolve()); }); } });
    const ready = ops({ reason: null, merged: false });
    expect((await draftPublish(settings, { ...at, round: 1, user: "1" }, clock, ready)).body.refused).toContain("Only the operator");
    expect((await draftPublish(settings, { ...at, round: 0, user: OPERATOR }, clock, ready)).body.refused).toBe("This card is for an older draft; use the newest card. Nothing was done.");
    expect((await draftPublish(settings, { ...at, round: 1, user: OPERATOR }, clock, ops({ reason: "the independent review is still running", merged: false }))).body.refused)
      .toBe("Not published yet: the independent review is still running.");
    expect((await draftPublish(settings, { ...at, round: 1, user: OPERATOR }, clock, ops(new Error("gh pr view failed: x")))).body.refused)
      .toBe("ghostpen could not check the pull request, so nothing changed: gh pr view failed: x");
    expect(merges).toBe(0);
    expect(draftOf(settings)?.status).toBe("ready");
    expect((await draftPublish(settings, { ...at, round: 1, user: OPERATOR }, clock, ready)).body.reply).toBe("Publishing now; its card says when it is on the blog.");
    expect(draftOf(settings)?.status).toBe("publishing");
    expect((await draftPublish(settings, { ...at, round: 1, user: OPERATOR }, clock, ready)).body.reply).toBe("It is being published now.");
    expect(merges).toBe(1);
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(draftOf(settings)?.status).toBe("published");
    expect((await draftPublish(settings, { ...at, user: OPERATOR }, clock, ready)).body.reply).toBe("It is on the blog already.");
    expect((await draftPublish(withDraft({ ...base, status: "failed" }), { ...at, user: OPERATOR }, clock, ready)).body.refused).toBe("This draft is not ready to publish, so nothing was done.");
  });

  it("puts a draft back to ready, saying why, when the merge fails; marks one merged elsewhere as published", async () => {
    const settings = withDraft(base);
    await draftPublish(settings, { ...at, user: OPERATOR }, () => NOW, { check: async () => ({ reason: null, merged: false }), merge: async () => { throw new Error("gh pr merge failed: conflict"); } });
    await new Promise((r) => setTimeout(r, 10));
    expect(draftOf(settings)).toMatchObject({ status: "ready", problem: "the merge failed: gh pr merge failed: conflict" });
    expect(draftCard(draftOf(settings)!, "d:1")!.text).toContain("Last try: the merge failed: gh pr merge failed: conflict");
    expect((await draftPublish(settings, { ...at, user: OPERATOR }, () => NOW, { check: async () => ({ reason: "it is published already", merged: true }), merge: async () => {} })).body.reply).toBe("It is on the blog already.");
    expect(draftOf(settings)).toMatchObject({ status: "published" });
    expect(draftOf(settings)?.problem).toBeUndefined();
  });

  it("after a stop mid-publish, the draft is ready again and says to press Publish again", () => {
    const settings = withDraft({ ...base, status: "publishing" });
    new DraftJobs(settings).resume();
    expect(draftOf(settings)).toMatchObject({ status: "ready", problem: "ghostpen stopped while publishing; press Publish again" });
    expect(draftCard({ ...base, status: "publishing" }, "d:1")).toEqual({ publish: false, edit: false, text: "**Publishing: T**\nhttps://github.com/o/blog/pull/7" });
  });

  it("sends the operator's changes to the writer, starting from the last draft", async () => {
    const settings = withDraft({ ...base, status: "failed" });
    const seen: unknown[] = [];
    const jobs = new DraftJobs(settings, { draft: async (_s, _id, _seams, edit) => { seen.push(edit?.notes); return draft({ title: "T2" }); }, open: async (_p, _d, _date, _run, branch) => ({ ...pr, branch: branch ?? "new" }), review: () => true, now: () => NOW });
    expect(draftEdit(settings, { ...at, user: "1", notes: "x" }, NOW, jobs).body.refused).toContain("Only the operator");
    expect(draftEdit(settings, { ...at, user: OPERATOR, notes: " " }, NOW, jobs).body.refused).toBe("An Edit needs the changes you want, so nothing was done.");
    expect(draftEdit(settings, { ...at, round: 5, user: OPERATOR, notes: "x" }, NOW, jobs).body.refused).toBe("This card is for an older draft; use the newest card. Nothing was done.");
    expect(draftEdit(settings, { ...at, user: OPERATOR, notes: "Shorter intro." }, NOW, undefined).body.refused).toContain("not drafting here");
    expect(draftEdit(settings, { ...at, user: OPERATOR, notes: "Shorter intro." }, NOW, jobs).body.reply).toContain("The writer is making your changes");
    expect(draftOf(settings)).toMatchObject({ status: "queued", round: 2, notes: "Shorter intro." });
    await jobs.idle();
    expect(seen).toEqual([undefined]); // no earlier draft file: the writer starts fresh
    expect(draftOf(settings)).toMatchObject({ status: "ready", round: 2, title: "T2", pr: { branch: "ghostpen/x" } });
    expect(draftOf(settings)?.notes).toBeUndefined();
    // With the last draft kept, an Edit hands the writer that draft and the changes.
    mkdirSync(join(settings.dataDir, "drafts"), { recursive: true });
    writeFileSync(draftFile(settings.dataDir, "d:1"), JSON.stringify(draft({ title: "T2" })));
    draftEdit(settings, { ...at, user: OPERATOR, notes: "Add a diagram." }, NOW, jobs);
    await jobs.idle();
    expect(seen).toEqual([undefined, "Add a diagram."]);
    expect(draftEdit(withDraft({ ...base, status: "drafting" }), { ...at, user: OPERATOR, notes: "x" }, NOW, jobs).body.refused).toBe("This draft cannot be edited now, so nothing was done.");
  });
});
