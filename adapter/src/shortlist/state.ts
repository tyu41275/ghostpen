/**
 * The shortlists ghostpen has made (`dataDir/shortlist.json`): per week, its items, where each was posted and how Tim
 * answered it. A week's items are fixed when it is first asked for, so every press answers the card it was on.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShortlistItem } from "./picks.js";

export type Action = "write" | "skip" | "later";
export interface Posted { channelRef: string; messageRef: string }
export interface Answer { action: Action; reason: string; by: string; at: string }
/** A Write's draft (ghostpen#90): where it is, its pull request, and the card last posted about it. */
export interface DraftState {
  status: "queued" | "drafting" | "ready" | "held" | "failed" | "error" | "publishing" | "published";
  /** 1 for the first draft, one more for each Edit. */
  round: number;
  /** The author's changes waiting for the writer (an Edit press). */
  notes?: string;
  title?: string;
  /** The check report in plain words. */
  report?: string;
  problem?: string;
  pr?: { number: number; url: string; branch: string; head: string; preview?: string };
  /** The card posted about this draft, and for which round and status. */
  card?: Posted & { round: number; status: string };
  at: string;
}
export interface WeekItem extends ShortlistItem { posted?: Posted; answer?: Answer; draft?: DraftState }
export interface ShortlistState { version: 1; weeks: Record<string, { madeAt: string; items: WeekItem[] }> }
export const SHORTLIST_FILE = "shortlist.json";

export function readShortlists(dataDir: string): ShortlistState {
  const path = join(dataDir, SHORTLIST_FILE);
  if (!existsSync(path)) return { version: 1, weeks: {} };
  const state = JSON.parse(readFileSync(path, "utf8")) as ShortlistState;
  if (state?.version !== 1 || !state.weeks || typeof state.weeks !== "object") throw new Error(`${SHORTLIST_FILE} is not ghostpen's shortlist file`);
  return state;
}

export function saveShortlists(dataDir: string, state: ShortlistState): void {
  const path = join(dataDir, SHORTLIST_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${path}.tmp`, path);
}

const WORDS: Record<Action, string> = { write: "Write: next to draft", skip: "Skipped", later: "Not yet: back in a later week" };

/** A card's text once answered: the proposal, then what was chosen, by whom, and the reason for a Skip. */
export const answeredText = (item: WeekItem): string => item.answer
  ? `${item.text}\n\n**${WORDS[item.answer.action]}** (<@${item.answer.by}>${item.answer.reason ? `: ${item.answer.reason}` : ""})`
  : item.text;

/** Finds a week's item; `null` when there is none. */
export function findItem(state: ShortlistState, week: unknown, index: unknown): WeekItem | null {
  if (typeof week !== "string" || typeof index !== "number") return null;
  return state.weeks[week]?.items[index] ?? null;
}
