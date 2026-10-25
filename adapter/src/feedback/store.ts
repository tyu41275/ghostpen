/**
 * Everything the operator tells ghostpen (ADR 0101, amended 2026-10-25 "threads and reasons"): the reason behind every
 * press, and, from a card's thread, questions with their answers and context for a topic. Kept in
 * `dataDir/feedback.json`, oldest first. Each entry waits for chatter's operator intake (ensemble-chatter#4637), so
 * Reflection can learn from it once that exists (`intake: "pending"` until then); ghostpen itself reads the context for
 * the writer and the reasons for the ranking.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FeedbackKind = "reason" | "context" | "question" | "answer";
export interface FeedbackEntry {
  at: string;
  /** Who said it (a Discord user id), or `ghostpen` for an answer. */
  by: string;
  /** The topic: a candidate id or `background:<part>`. */
  topic: string;
  kind: FeedbackKind;
  /** For a reason: the press it explains (write, skip, later, publish). */
  action?: string;
  /** For a reason: whether it was one of the card's choices rather than typed. */
  chip?: boolean;
  text: string;
  intake: "pending";
}
interface FeedbackState { version: 1; entries: FeedbackEntry[] }
export const FEEDBACK_FILE = "feedback.json";
const MAX_TEXT = 4000;

export function readFeedback(dataDir: string): FeedbackEntry[] {
  const path = join(dataDir, FEEDBACK_FILE);
  if (!existsSync(path)) return [];
  const state = JSON.parse(readFileSync(path, "utf8")) as FeedbackState;
  if (state?.version !== 1 || !Array.isArray(state.entries)) throw new Error(`${FEEDBACK_FILE} is not ghostpen's feedback file`);
  return state.entries;
}

export function addFeedback(dataDir: string, entry: Omit<FeedbackEntry, "intake" | "text"> & { text: string }): FeedbackEntry {
  const entries = readFeedback(dataDir);
  const kept: FeedbackEntry = { ...entry, text: entry.text.trim().slice(0, MAX_TEXT), intake: "pending" };
  entries.push(kept);
  const path = join(dataDir, FEEDBACK_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, entries }, null, 2));
  renameSync(`${path}.tmp`, path);
  return kept;
}

/** The context the operator gave for `topic`, oldest first: what the writer is told. */
export const contextFor = (dataDir: string, topic: string): string[] =>
  readFeedback(dataDir).filter((e) => e.topic === topic && e.kind === "context").map((e) => e.text);
