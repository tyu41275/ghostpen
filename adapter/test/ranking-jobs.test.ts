import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTEMPT_FILE, attemptRanking, HELD, LOCK_FILE, pidAlive, readAttempt, STALE_LOCK_MS } from "../src/ranking/attempt.js";
import { FRESH_MS, RANK_EVERY_MS, RankJobs, rankingDue, RETRY_MS, type DueFacts } from "../src/ranking/jobs.js";
import type { RankingView } from "../src/ranking/run.js";
import { RANKING_STALE_MS } from "../src/service/readiness-jobs.js";
import { parseSettings } from "../src/settings.js";
import { tempDir } from "./helpers.js";

const NOW = Date.parse("2026-11-13T12:00:00Z"), MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const settings = () => parseSettings({ instance: "host", port: 8794, dataDir: tempDir(), scorer: { command: ["unused"] },
  sources: { topics: [{ name: "notes", kind: "markdown", root: tempDir(), include: ["*.md"] }] } });
const view = (at = NOW): RankingView => ({ ranAt: new Date(at).toISOString(), entries: [], background: [], owed: [], problems: [] });
/** A rank that resolves only when the test says, counting its calls. */
function held() {
  let release!: (v: RankingView) => void, fail!: (e: Error) => void, calls = 0;
  const rank = () => { calls += 1; return new Promise<RankingView>((res, rej) => { release = res; fail = rej; }); };
  return { rank, release: (v = view()) => release(v), fail: (e: Error) => fail(e), calls: () => calls };
}
const deps = (rank: () => Promise<RankingView>, alive = (_pid: number) => true) => ({ rank, now: () => new Date(NOW), alive, pid: 4242 });

describe("when a ranking is due", () => {
  const base: DueFacts = { scorer: true, topics: 1, running: false, weekMade: false, ranAt: NOW - 18 * DAY, now: NOW };
  const table: Array<[string, Partial<DueFacts>, boolean]> = [
    ["an 18-day-old ranking, the week not made", {}, true],
    ["no ranking yet", { ranAt: undefined }, true],
    ["no scorer", { scorer: false }, false],
    ["no topics", { topics: 0 }, false],
    ["one running", { running: true }, false],
    ["a failed try 59 minutes ago", { failedAt: NOW - 59 * MINUTE }, false],
    ["a failed try 61 minutes ago", { failedAt: NOW - 61 * MINUTE }, true],
    ["a ranking under a day old, the week not made", { ranAt: NOW - FRESH_MS + MINUTE }, false],
    ["a ranking over a day old, the week not made", { ranAt: NOW - FRESH_MS - MINUTE }, true],
    ["a 2-day-old ranking, the week made", { ranAt: NOW - 2 * DAY, weekMade: true }, false],
    ["a ranking over 7 days old, the week made", { ranAt: NOW - RANK_EVERY_MS - MINUTE, weekMade: true }, true],
    ["no ranking yet, the week made", { ranAt: undefined, weekMade: true }, true],
  ];
  for (const [name, over, due] of table) it(`${due ? "is due" : "is not due"} with ${name}`, () => expect(rankingDue({ ...base, ...over })).toBe(due));

  it("ranks again before the readiness list calls a ranking stale, and waits an hour after a failed try", () => {
    expect(RANK_EVERY_MS).toBeLessThan(RANKING_STALE_MS);
    expect(RETRY_MS).toBe(60 * MINUTE);
  });
});

describe("one ranking at a time", () => {
  it("runs one ranking however many asks come while it runs, and keeps it as ok", async () => {
    const s = settings(), fake = held(), jobs = new RankJobs(s, deps(fake.rank));
    expect(jobs.startIfDue("2026-11-09", false, new Date(NOW))).toBe(true);
    expect(jobs.startIfDue("2026-11-09", false, new Date(NOW))).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(fake.calls()).toBe(1);
    expect(readAttempt(s.dataDir)).toMatchObject({ by: "service", week: "2026-11-09", outcome: "running" });
    expect(existsSync(join(s.dataDir, LOCK_FILE))).toBe(true);
    fake.release();
    await jobs.idle();
    expect(fake.calls()).toBe(1);
    expect(readAttempt(s.dataDir)).toMatchObject({ outcome: "ok", endedAt: new Date(NOW).toISOString() });
    expect(existsSync(join(s.dataDir, LOCK_FILE))).toBe(false);
  });

  it("skips while a live process holds the lock, leaving its lock, and runs nothing", async () => {
    const s = settings(), fake = held(), lock = join(s.dataDir, LOCK_FILE);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: "2026-11-13T11:00:00Z" }));
    utimesSync(lock, new Date(NOW), new Date(NOW));
    const { attempt, view: ranked } = await attemptRanking(s, "service", "2026-11-09", deps(fake.rank, pidAlive));
    expect([attempt.outcome, attempt.problem, ranked, fake.calls()]).toEqual(["skipped", HELD, undefined, 0]);
    expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(process.pid);
    expect(readAttempt(s.dataDir)).toMatchObject({ outcome: "skipped", week: "2026-11-09" });
  });

  it("keeps the holder's running record when it skips", async () => {
    const s = settings(), fake = held(), lock = join(s.dataDir, LOCK_FILE);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: "2026-11-13T11:00:00Z" }));
    utimesSync(lock, new Date(NOW), new Date(NOW));
    const running = { by: "hand", startedAt: "2026-11-13T11:00:00.000Z", outcome: "running" };
    writeFileSync(join(s.dataDir, ATTEMPT_FILE), JSON.stringify(running));
    expect((await attemptRanking(s, "service", "2026-11-09", deps(fake.rank, pidAlive))).attempt.outcome).toBe("skipped");
    expect(readAttempt(s.dataDir)).toEqual(running);
  });

  it("takes over a live pid's lock once it is older than any ranking runs (the pid may be another process's now)", async () => {
    const s = settings(), lock = join(s.dataDir, LOCK_FILE);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: "2026-11-12T00:00:00Z" }));
    const at = (ms: number) => { const d = new Date(NOW - ms); utimesSync(lock, d, d); };
    at(STALE_LOCK_MS - 60_000);
    expect((await attemptRanking(s, "service", "2026-11-09", deps(held().rank, pidAlive))).attempt.outcome).toBe("skipped");
    at(STALE_LOCK_MS + 60_000);
    const fake = held(), done = attemptRanking(s, "service", "2026-11-09", deps(fake.rank, pidAlive));
    fake.release();
    expect((await done).attempt.outcome).toBe("ok");
    expect(existsSync(lock)).toBe(false);
  });

  it("takes over a lock whose process is not alive", async () => {
    const s = settings(), fake = held(), lock = join(s.dataDir, LOCK_FILE);
    writeFileSync(lock, JSON.stringify({ pid: 999_999_999, startedAt: "2026-11-01T00:00:00Z" }));
    const done = attemptRanking(s, "hand", undefined, deps(fake.rank, () => false));
    await Promise.resolve();
    expect(JSON.parse(readFileSync(lock, "utf8")).pid).toBe(4242);
    fake.release();
    expect((await done).attempt).toMatchObject({ by: "hand", outcome: "ok" });
    expect(existsSync(lock)).toBe(false);
  });

  it("keeps a throw as failed with its first line, and removes the lock", async () => {
    const s = settings(), fake = held();
    const done = attemptRanking(s, "service", "2026-11-09", deps(fake.rank));
    await Promise.resolve();
    fake.fail(new Error("scorer: the scorer died\nat a stack line"));
    expect((await done).attempt).toMatchObject({ outcome: "failed", problem: "scorer: the scorer died" });
    expect(JSON.parse(readFileSync(join(s.dataDir, ATTEMPT_FILE), "utf8")).outcome).toBe("failed");
    expect(existsSync(join(s.dataDir, LOCK_FILE))).toBe(false);
  });

  it("tries again only an hour after a failed try", async () => {
    const s = settings(), fake = held(), jobs = new RankJobs(s, deps(fake.rank));
    jobs.startIfDue("2026-11-09", false, new Date(NOW));
    await Promise.resolve();
    fake.fail(new Error("no"));
    await jobs.idle();
    expect(jobs.startIfDue("2026-11-09", false, new Date(NOW + 59 * MINUTE))).toBe(false);
    expect(jobs.startIfDue("2026-11-09", false, new Date(NOW + 61 * MINUTE))).toBe(true);
    await Promise.resolve();
    fake.release();
    await jobs.idle();
    expect(fake.calls()).toBe(2);
  });
});
