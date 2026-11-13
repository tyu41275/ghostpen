/**
 * The service ranks on its own (ghostpen#118). Nothing runs on a timer: each keyed ask for the weekly shortlist (chatter's
 * adapter asks every 10 minutes) checks `rankingDue`, and a due ranking starts on a promise chain without holding up the
 * answer, one at a time (the `DraftJobs` pattern, publish/jobs.ts). The next ask makes the week from the fresh ranking.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhostpenSettings } from "../settings.js";
import { attemptRanking, readAttempt, type AttemptDeps } from "./attempt.js";
import { isRankingView, RANKING_FILE } from "./run.js";

const HOUR_MS = 60 * 60_000;
/** A failed try is not tried again for this long. */
export const RETRY_MS = HOUR_MS;
/** A week not made yet is made from a ranking this fresh, else it is ranked first. */
export const FRESH_MS = 24 * HOUR_MS;
/** Ranked again this often even when no week waits on it; kept under the readiness list's RANKING_STALE_MS (8 days). */
export const RANK_EVERY_MS = 7 * 24 * HOUR_MS;

/** What `rankingDue` is decided on. `ranAt` is the last ranking's; `failedAt`, when the last try failed, when it ended. */
export interface DueFacts { scorer: boolean; topics: number; running: boolean; weekMade: boolean; ranAt?: number | undefined; failedAt?: number | undefined; now: number }

/** Whether a ranking should start now. */
export function rankingDue(f: DueFacts): boolean {
  if (!f.scorer || f.topics === 0 || f.running) return false;
  if (f.failedAt !== undefined && f.now - f.failedAt <= RETRY_MS) return false;
  const age = f.ranAt === undefined ? Number.POSITIVE_INFINITY : f.now - f.ranAt;
  return (!f.weekMade && age > FRESH_MS) || age > RANK_EVERY_MS;
}

const timeOf = (text: unknown) => { const at = typeof text === "string" ? Date.parse(text) : Number.NaN; return Number.isFinite(at) ? at : undefined; };

/** The last readable ranking's `ranAt`, undefined when there is none. */
function lastRanAt(dataDir: string): number | undefined {
  const path = join(dataDir, RANKING_FILE);
  try {
    const view: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    return isRankingView(view) ? timeOf(view.ranAt) : undefined;
  } catch { return undefined; }
}

export class RankJobs {
  private chain: Promise<void> = Promise.resolve();
  private running = false;
  constructor(private readonly settings: GhostpenSettings, private readonly deps: Partial<AttemptDeps> = {}) {}

  /** Starts a ranking for `week` when one is due. True while one runs (started now or before): the week waits for it. */
  startIfDue(week: string, weekMade: boolean, now: Date): boolean {
    if (this.running) return true;
    const last = readAttempt(this.settings.dataDir);
    const failedAt = last?.outcome === "failed" ? timeOf(last.endedAt ?? last.startedAt) : undefined;
    if (!rankingDue({ scorer: this.settings.scorer !== undefined, topics: this.settings.sources.topics.length, running: this.running, weekMade,
      ranAt: lastRanAt(this.settings.dataDir), failedAt, now: now.getTime() })) return false;
    this.running = true;
    this.chain = this.chain.then(() => attemptRanking(this.settings, "service", week, this.deps))
      .then(() => undefined, () => undefined /* a record that could not be written: the next ask tries again */)
      .then(() => { this.running = false; });
    return true;
  }

  /** Resolves when the running ranking is done (tests, shutdown). */
  idle(): Promise<void> { return this.chain; }
}
