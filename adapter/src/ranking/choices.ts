/**
 * Tim's choices and what they teach (ADR 0101, brief D13): every Write pick and every Skip (with its one-line reason) is
 * kept in ghostpen's data folder. From them ghostpen **suggests** new weights: a factor that the posts Tim writes score
 * higher on than the ones he skips gains weight, and the other way round. A suggestion is shown and explained before it
 * applies (`applyWeights`, called only after the operator agrees); nothing changes a weight on its own.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WEIGHTS, type Score, type Weights } from "./scores.js";
import type { Booking } from "./rank.js";

export type Choice = "write" | "skip" | "not-yet";
export interface ChoiceRecord { candidate: string; choice: Choice; reason: string; at: string; scores: Score[] }
export interface ChoicesState { version: 1; weights: Weights; choices: ChoiceRecord[]; bookings: Booking[] }
export const CHOICES_FILE = "choices.json";
/** How far one suggestion may move a weight, and the bounds a weight stays in. */
const STEP = 0.5, MIN = 0.25, MAX = 3;

const fresh = (): ChoicesState => ({ version: 1, weights: { ...DEFAULT_WEIGHTS }, choices: [], bookings: [] });

/** The stored state; a missing file is a fresh start, an unreadable one throws (never silently reset). */
export function readChoices(dataDir: string): ChoicesState {
  const path = join(dataDir, CHOICES_FILE);
  if (!existsSync(path)) return fresh();
  const state = JSON.parse(readFileSync(path, "utf8")) as ChoicesState;
  if (state?.version !== 1 || !Array.isArray(state.choices) || !Array.isArray(state.bookings) || typeof state.weights !== "object") {
    throw new Error(`${CHOICES_FILE} is not ghostpen's choices file`);
  }
  return state;
}

function save(dataDir: string, state: ChoicesState): void {
  const path = join(dataDir, CHOICES_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${path}.tmp`, path);
}

/** Record one choice. A Skip needs its one-line reason; Write on a decision post books its post-mortem. */
export function recordChoice(dataDir: string, record: Omit<ChoiceRecord, "at">, kind: "decision" | "post-mortem", title: string,
  now: Date = new Date()): ChoicesState {
  const reason = record.reason.trim().split("\n")[0]!.slice(0, 200);
  if (record.choice === "skip" && !reason) throw new Error("a Skip needs a one-line reason");
  const state = readChoices(dataDir);
  state.choices.push({ ...record, reason, at: now.toISOString() });
  if (record.choice === "write" && kind === "decision" && !state.bookings.some((b) => b.decision === record.candidate)) {
    state.bookings.push({ decision: record.candidate, title, bookedAt: now.toISOString() });
  }
  save(dataDir, state);
  return state;
}

export interface WeightSuggestion { factor: string; from: number; to: number; why: string }

/**
 * Suggested weights from Write and Skip choices (Not yet teaches nothing): for each factor, the average score of written
 * candidates minus that of skipped ones, a third of it per suggestion (at most half a point), kept within bounds. Needs
 * at least one of each; a factor with no difference is left alone.
 */
export function suggestWeights(state: ChoicesState): WeightSuggestion[] {
  const of = (choice: Choice, factor: string) => state.choices.filter((c) => c.choice === choice)
    .map((c) => c.scores.find((s) => s.factor === factor)?.score).filter((v): v is number => v !== undefined);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  return Object.keys(state.weights).flatMap((factor) => {
    const written = of("write", factor), skipped = of("skip", factor);
    if (written.length === 0 || skipped.length === 0) return [];
    const gap = mean(written) - mean(skipped);
    const from = state.weights[factor]!;
    const to = Math.round(Math.min(MAX, Math.max(MIN, from + Math.max(-STEP, Math.min(STEP, gap / 3)))) * 100) / 100;
    if (to === from) return [];
    return [{ factor, from, to, why: `posts you wrote scored ${mean(written).toFixed(1)} on ${factor}, posts you skipped ${mean(skipped).toFixed(1)}` }];
  });
}

/** Apply suggestions the operator agreed to. */
export function applyWeights(dataDir: string, agreed: WeightSuggestion[]): ChoicesState {
  const state = readChoices(dataDir);
  for (const s of agreed) if (s.factor in state.weights) state.weights[s.factor] = s.to;
  save(dataDir, state);
  return state;
}
