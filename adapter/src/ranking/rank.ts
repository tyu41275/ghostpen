/**
 * The ranking (ADR 0101, brief D3 to D7): candidates ordered by their weighted score, each with its **explanation cost**
 * (the stack parts a reader would need explained that have no post of their own yet), the **background posts** those
 * costs add up to, ordered by how many top candidates each would unlock, and the **post-mortems owed** for decision
 * posts already published before their outcome. Explanation cost orders background posts; it never lowers a score.
 */
import type { PublishedIndex } from "../sources/published.js";
import { postsAbout } from "../sources/published.js";
import type { Candidate } from "./candidates.js";
import { total, type Score, type Weights } from "./scores.js";

export interface Ranked {
  candidate: Candidate;
  scores: Score[];
  total: number;
  /** Stack parts the candidate names that no published post is about, lower case, sorted. */
  explain: string[];
}
export interface BackgroundPost { part: string; unlocks: string[] }
/** A decision post published before its outcome: its post-mortem is due once a source shows what happened. */
export interface Booking { decision: string; title: string; bookedAt: string }
export interface OwedPostMortem extends Booking { due: boolean; evidence: string[] }
export interface Ranking { ranked: Ranked[]; background: BackgroundPost[]; owed: OwedPostMortem[] }

/** How many of the top candidates count toward which background post comes first. */
export const TOP = 15;

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const names = (text: string, term: string) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term)}($|[^A-Za-z0-9])`, "iu").test(text);
/** A document's handle as a whole token: a file name (".md" allowed after it) or ADR number not continued by more of a name. */
const token = (text: string, handle: string) =>
  new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(handle)}(?![A-Za-z0-9_-]|\\.(?!md\\b)[A-Za-z0-9])`, "u").test(text);

/** The stack parts (from `terms`) a candidate's document names that no published post is about. */
export function explanationCost(candidate: Candidate, terms: string[], index: PublishedIndex): string[] {
  const text = candidate.document.lines.join("\n");
  const wanted = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return wanted.filter((term) => names(text, term) && postsAbout(index, term).length === 0).sort();
}

/** What a decision document goes by in other documents: its file name, and its ADR number when it has one. */
function handles(decision: Candidate): string[] {
  const file = decision.document.location.path?.split("/").pop()?.replace(/\.md$/u, "");
  const adr = /\bADR (\d{3,4})\b/u.exec(decision.title)?.[1];
  return [file, adr ? `ADR ${adr}` : undefined].filter((h): h is string => !!h && h.length >= 6);
}

/** Each booking, due once a post-mortem candidate (experiment, incident, measured PR) names its decision. */
export function owedPostMortems(bookings: Booking[], candidates: Candidate[]): OwedPostMortem[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const outcomes = candidates.filter((c) => c.kind === "post-mortem");
  return bookings.map((booking) => {
    const decision = byId.get(booking.decision);
    const wanted = decision ? handles(decision) : [];
    // Whole tokens only: "ADR 00220" or "0022-other-name.md" never stand for ADR 0022.
    const evidence = outcomes.filter((o) => wanted.some((h) => token(o.document.lines.join("\n"), h))).map((o) => o.id);
    return { ...booking, due: evidence.length > 0, evidence };
  });
}

export function rank(candidates: Candidate[], scored: Map<string, Score[]>, weights: Weights, terms: string[],
  index: PublishedIndex, bookings: Booking[] = []): Ranking {
  const ranked = candidates.filter((c) => scored.has(c.id)).map((candidate) => {
    const scores = scored.get(candidate.id)!;
    return { candidate, scores, total: total(scores, weights), explain: explanationCost(candidate, terms, index) };
  }).sort((a, b) => b.total - a.total || a.explain.length - b.explain.length || a.candidate.id.localeCompare(b.candidate.id));
  const unlocks = new Map<string, string[]>();
  for (const entry of ranked.slice(0, TOP)) {
    for (const part of entry.explain) unlocks.set(part, [...(unlocks.get(part) ?? []), entry.candidate.id]);
  }
  const background = [...unlocks].map(([part, ids]) => ({ part, unlocks: ids }))
    .sort((a, b) => b.unlocks.length - a.unlocks.length || a.part.localeCompare(b.part));
  return { ranked, background, owed: owedPostMortems(bookings, candidates) };
}
