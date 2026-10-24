/**
 * Scores (ADR 0101, brief D5 and D6). A decision post is scored on stakes, carry-over and thought process; a post-mortem
 * on evidence, surprise and completeness; 0 to 3 each. **Every score quotes the line that earns it**, and the quote is
 * checked here against the document itself: a quote that is not in it, word for word, makes the score 0. Whoever scores
 * (a model, a person) cannot raise a candidate with words the source does not hold.
 */
import type { Candidate, PostKind } from "./candidates.js";

export const FACTORS: Record<PostKind, readonly string[]> = {
  decision: ["stakes", "carryOver", "thoughtProcess"],
  "post-mortem": ["evidence", "surprise", "completeness"],
};

/** What a scorer says about one factor: a score and the exact words of the source that earn it. */
export interface ProposedScore { score: number; quote: string }
/** A checked score: the line the quote is on, or why it counts for nothing. */
export interface Score { factor: string; score: number; quote: string; line: number | null; note?: string }

export type Weights = Record<string, number>;
export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(Object.values(FACTORS).flat().map((factor) => [factor, 1]));

const normal = (text: string) => text.replace(/\s+/gu, " ").trim();

/** The 1-based line holding `quote` (whitespace-insensitive, within one line), or null. */
export function lineOf(candidate: Candidate, quote: string): number | null {
  const wanted = normal(quote);
  if (wanted.length < 8) return null; // a word or two proves nothing
  const index = candidate.document.lines.findIndex((line) => normal(line).includes(wanted));
  return index < 0 ? null : index + 1;
}

/** Each factor of the candidate's kind, checked: missing, out of range or unquoted is 0, saying why. */
export function checkScores(candidate: Candidate, proposed: Record<string, ProposedScore | undefined>): Score[] {
  return FACTORS[candidate.kind].map((factor) => {
    const given = proposed[factor];
    if (!given || !Number.isInteger(given.score) || given.score < 0 || given.score > 3) {
      return { factor, score: 0, quote: given?.quote ?? "", line: null, note: "no score from 0 to 3 was given" };
    }
    if (given.score === 0) return { factor, score: 0, quote: given.quote ?? "", line: null };
    const line = typeof given.quote === "string" ? lineOf(candidate, given.quote) : null;
    if (line === null) return { factor, score: 0, quote: given.quote ?? "", line: null, note: "its quote is not in the source" };
    return { factor, score: given.score, quote: given.quote, line };
  });
}

/** The weighted total: each factor's score times its weight (1 unless Tim's choices changed it). */
export const total = (scores: Score[], weights: Weights = DEFAULT_WEIGHTS): number =>
  Math.round(scores.reduce((sum, s) => sum + s.score * (weights[s.factor] ?? 1), 0) * 100) / 100;
