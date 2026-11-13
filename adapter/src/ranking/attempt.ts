/**
 * One ranking try, by the service or by hand (ghostpen#118). Every try takes `dataDir/ranking.lock` first (opened with
 * `wx`, holding the taker's pid and start time), so one ranking runs at a time; a lock whose pid is not alive is taken
 * over, and the lock is always removed when the try ends. What the last try did is kept in `dataDir/ranking-attempt.json`
 * (written to a temporary file and renamed, like ranking.json) for the readiness list and the app page.
 */
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GhostpenSettings } from "../settings.js";
import { rankNow, type RankingView } from "./run.js";

export const ATTEMPT_FILE = "ranking-attempt.json";
export const LOCK_FILE = "ranking.lock";
/** A skipped try's problem, and what the rank command says when it finds a ranking running. */
export const HELD = "a ranking is running already";
/** A lock that cannot be read yet (its taker is still writing it) counts as held for this long. */
const UNREAD_LOCK_MS = 60_000;
/** A lock older than this is taken over even when its pid is alive: that pid may be another process's now, and no
 * ranking runs this long, so a stale lock never holds every week's shortlist back. */
export const STALE_LOCK_MS = 12 * 60 * 60_000;

export type AttemptOutcome = "running" | "ok" | "failed" | "skipped";
export interface RankingAttempt { by: "service" | "hand"; week?: string; startedAt: string; endedAt?: string; outcome: AttemptOutcome; problem?: string }
export interface AttemptDeps { rank: (settings: GhostpenSettings) => Promise<RankingView>; now: () => Date; alive: (pid: number) => boolean; pid: number }

/** Whether `pid` is a running process: signal 0 sends nothing, it only asks. EPERM is a process of another user. */
export const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};
export const ATTEMPT_DEFAULTS: AttemptDeps = { rank: (settings) => rankNow(settings), now: () => new Date(), alive: pidAlive, pid: process.pid };

const OUTCOMES: readonly string[] = ["running", "ok", "failed", "skipped"];
const optional = (v: unknown) => v === undefined || typeof v === "string";

/** The kept record, undefined when the text is not one ghostpen wrote. */
export function parseAttempt(text: string): RankingAttempt | undefined {
  const v: unknown = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;
  const ok = (a.by === "service" || a.by === "hand") && typeof a.startedAt === "string" && OUTCOMES.includes(a.outcome as string)
    && optional(a.week) && optional(a.endedAt) && optional(a.problem);
  return ok ? a as unknown as RankingAttempt : undefined;
}

/** The last try, null when none is kept or the file is not one ghostpen wrote. */
export function readAttempt(dataDir: string): RankingAttempt | null {
  try { return parseAttempt(readFileSync(join(dataDir, ATTEMPT_FILE), "utf8")) ?? null; } catch { return null; }
}

function writeAttempt(dataDir: string, attempt: RankingAttempt): void {
  const path = join(dataDir, ATTEMPT_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(attempt, null, 2));
  renameSync(`${path}.tmp`, path);
}

/** Takes the lock: false when a live process holds it. A lock whose pid is not alive is removed and taken. */
function takeLock(dataDir: string, deps: AttemptDeps): boolean {
  const path = join(dataDir, LOCK_FILE);
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      writeFileSync(path, JSON.stringify({ pid: deps.pid, startedAt: deps.now().toISOString() }), { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let pid: unknown;
    try { pid = (JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown }).pid; } catch { /* not readable yet */ }
    const age = deps.now().getTime() - mtime(path);
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? deps.alive(pid) && age < STALE_LOCK_MS : age < UNREAD_LOCK_MS) return false;
    rmSync(path, { force: true });
  }
  return false;
}
const mtime = (path: string) => { try { return statSync(path).mtimeMs; } catch { return 0; } };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300);

/** One try: skipped while another holds the lock, else the ranking, kept as ok or failed. Rejects only when the record cannot be written. */
export async function attemptRanking(settings: GhostpenSettings, by: RankingAttempt["by"], week?: string, given: Partial<AttemptDeps> = {}):
  Promise<{ attempt: RankingAttempt; view?: RankingView }> {
  const deps = { ...ATTEMPT_DEFAULTS, ...given };
  const base = { by, ...(week ? { week } : {}), startedAt: deps.now().toISOString() };
  if (!takeLock(settings.dataDir, deps)) {
    const attempt: RankingAttempt = { ...base, endedAt: base.startedAt, outcome: "skipped", problem: HELD };
    // The holder's own "running" record says more than this skip: it stays.
    if (readAttempt(settings.dataDir)?.outcome !== "running") writeAttempt(settings.dataDir, attempt);
    return { attempt };
  }
  try {
    writeAttempt(settings.dataDir, { ...base, outcome: "running" });
    let view: RankingView;
    try {
      view = await deps.rank(settings);
    } catch (error) {
      const attempt: RankingAttempt = { ...base, endedAt: deps.now().toISOString(), outcome: "failed", problem: message(error) };
      writeAttempt(settings.dataDir, attempt);
      return { attempt };
    }
    const attempt: RankingAttempt = { ...base, endedAt: deps.now().toISOString(), outcome: "ok" };
    writeAttempt(settings.dataDir, attempt);
    return { attempt, view };
  } finally {
    rmSync(join(settings.dataDir, LOCK_FILE), { force: true });
  }
}
