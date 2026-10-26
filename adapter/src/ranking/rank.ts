/**
 * The ranking (ADR 0101, brief D3 to D7): candidates ordered by their weighted score, each with its **explanation cost**
 * (the stack parts a reader would need explained that have no post of their own yet), the **background posts** those
 * costs add up to, ordered by how many top candidates each would unlock, and the **post-mortems owed** for decision
 * posts already published before their outcome. Explanation cost orders background posts; it never lowers a score.
 *
 * A part counts only where the document uses it as a part (ghostpen#111): in its title, or named three times or more,
 * the draft check's rule (draft/stack-parts.ts). One passing mention of a word that is also a glossary term is not a
 * cost. A term two glossaries define differently is a problem to report, never a background post to propose, until one
 * definition wins. Each background post carries its references: where each glossary defines the part and the line
 * where each top candidate names it, so the operator can see what the proposal rests on.
 */
import type { PublishedIndex } from "../sources/published.js";
import { postsAbout } from "../sources/published.js";
import type { Definition, TopicDocument } from "../sources/types.js";
import type { Candidate } from "./candidates.js";
import { total, type Score, type Weights } from "./scores.js";

export interface Ranked {
  candidate: Candidate;
  scores: Score[];
  total: number;
  /** Stack parts central to the candidate that no published post is about, lower case, sorted. */
  explain: string[];
}
/** Where a top candidate names the part: the first line that does, quoted. */
export interface Mention { id: string; line: number; quote: string }
/** One glossary's definition of the part: where it is (`path:line` or a web address) and its first sentence. */
export interface Defined { where: string; text: string }
export interface BackgroundPost { part: string; unlocks: string[]; mentions: Mention[]; defined: Defined[] }
/** A decision post published before its outcome: its post-mortem is due once a source shows what happened. */
export interface Booking { decision: string; title: string; bookedAt: string }
export interface OwedPostMortem extends Booking { due: boolean; evidence: string[] }
export interface Ranking { ranked: Ranked[]; background: BackgroundPost[]; owed: OwedPostMortem[]; problems: string[] }

/** How many of the top candidates count toward which background post comes first. */
export const TOP = 15;
/** A quoted line or definition is clipped here: enough to recognise, short enough for a card. */
const QUOTE = 160;

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const termRe = (term: string, flags = "giu") => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term)}(?=$|[^A-Za-z0-9])`, flags);
/** A document's handle as a whole token: a file name (".md" allowed after it) or ADR number not continued by more of a name. */
const token = (text: string, handle: string) =>
  new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(handle)}(?![A-Za-z0-9_-]|\\.(?!md\\b)[A-Za-z0-9])`, "u").test(text);

export interface Naming { count: number; central: boolean; line: number; quote: string }

/**
 * The document's prose, line by line (the draft check's `prose`, draft/plain.ts, kept per line so a mention keeps its
 * line number): nothing inside fenced code or front matter, no heading, table or quote-only line, and inline code,
 * images, link addresses and HTML taken out of the lines that stay. A term named only in code or subheadings is not
 * named in prose.
 */
export function proseLines(lines: string[]): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let fenced = false, front = lines[0] === "---";
  for (const [i, raw] of lines.entries()) {
    if (front) { if (i > 0 && raw === "---") front = false; continue; }
    if (/^\s*```/u.test(raw)) { fenced = !fenced; continue; }
    if (fenced || /^\s*(#|\||>?\s*$)/u.test(raw)) continue;
    const text = raw.replace(/`[^`\n]*`/gu, " code ").replace(/!\[[^\]]*\]\([^)]*\)/gu, " ").replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/https?:\/\/[^\s)>\]]+/gu, " link ").replace(/<[^>]+>/gu, " ");
    out.push({ line: i + 1, text });
  }
  return out;
}

/**
 * How a document names `term` as a whole word, in its title and its prose (the draft check's count): how often, the
 * first line that does, and whether that makes it central: in the title, or three times or more.
 */
export function naming(document: TopicDocument, term: string): Naming | null {
  const inTitle = termRe(term, "iu").test(document.title);
  let count = inTitle ? 1 : 0, line = 0, quote = "";
  for (const { line: at, text } of proseLines(document.lines)) {
    const n = (text.match(termRe(term)) ?? []).length;
    if (n > 0 && line === 0) { line = at; quote = document.lines[at - 1]!.trim().slice(0, QUOTE); }
    count += n;
  }
  if (count === 0) return null;
  if (inTitle && (line === 0 || termRe(term, "iu").test(document.lines[0] ?? ""))) { line = 1; quote = document.lines[0]!.trim().slice(0, QUOTE); }
  return { count, central: inTitle || count >= 3, line, quote };
}

/** The stack parts (from `terms`) central to a candidate's document that no published post is about. */
export function explanationCost(candidate: Candidate, terms: string[], index: PublishedIndex): string[] {
  const wanted = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return wanted.filter((term) => naming(candidate.document, term)?.central && postsAbout(index, term).length === 0).sort();
}

const where = (d: Definition) => d.location.url ?? `${d.location.path ?? d.source}${d.location.line ? `:${d.location.line}` : ""}`;
const sentence = (text: string) => (/^[\s\S]*?[.!?](?=\s|$)/u.exec(text.replace(/\s+/gu, " ").trim())?.[0] ?? text.replace(/\s+/gu, " ").trim()).slice(0, QUOTE);

/** Each term by its lower-case name, with every definition of it; a clash is two definitions whose texts differ. */
export function definitionsByTerm(definitions: Definition[]): Map<string, Definition[]> {
  const byTerm = new Map<string, Definition[]>();
  for (const d of definitions) {
    const term = d.term.trim().toLowerCase();
    if (term) byTerm.set(term, [...(byTerm.get(term) ?? []), d]);
  }
  return byTerm;
}
const clashes = (defs: Definition[]) => new Set(defs.map((d) => d.text.replace(/\s+/gu, " ").trim().toLowerCase())).size > 1;

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

export function rank(candidates: Candidate[], scored: Map<string, Score[]>, weights: Weights, definitions: Definition[],
  index: PublishedIndex, bookings: Booking[] = []): Ranking {
  const byTerm = definitionsByTerm(definitions);
  const problems: string[] = [];
  const terms: string[] = [];
  for (const [term, defs] of byTerm) {
    if (!clashes(defs)) { terms.push(term); continue; }
    problems.push(`glossaries: "${term}" is defined differently at ${defs.map(where).join(" and ")}: it counts for no topic and no background post is proposed for it until one definition wins`);
  }
  const ranked = candidates.filter((c) => scored.has(c.id)).map((candidate) => {
    const scores = scored.get(candidate.id)!;
    return { candidate, scores, total: total(scores, weights), explain: explanationCost(candidate, terms, index) };
  }).sort((a, b) => b.total - a.total || a.explain.length - b.explain.length || a.candidate.id.localeCompare(b.candidate.id));
  const unlocks = new Map<string, Mention[]>();
  for (const entry of ranked.slice(0, TOP)) {
    for (const part of entry.explain) {
      const named = naming(entry.candidate.document, part)!;
      unlocks.set(part, [...(unlocks.get(part) ?? []), { id: entry.candidate.id, line: named.line, quote: named.quote }]);
    }
  }
  const background = [...unlocks].map(([part, mentions]) => ({ part, unlocks: mentions.map((m) => m.id), mentions,
    defined: (byTerm.get(part) ?? []).map((d) => ({ where: where(d), text: sentence(d.text) })) }))
    .sort((a, b) => b.unlocks.length - a.unlocks.length || a.part.localeCompare(b.part));
  return { ranked, background, owed: owedPostMortems(bookings, candidates), problems };
}
