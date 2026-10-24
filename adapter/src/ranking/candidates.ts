/**
 * Candidates (ADR 0101, brief D4 and D5): one possible post per source document, with the parts that make it up. A
 * decision document (a brief or an ADR) gives a **decision post**: its decisions, the options it turned down,
 * and anything it says happened. An experiment record, an incident issue or a pull request with measured results gives
 * a **post-mortem**. The parts of one document always merge into one candidate, so a rich document is never counted twice.
 */
import type { TopicDocument } from "../sources/types.js";

export type PostKind = "decision" | "post-mortem";
export type PartKind = "decision" | "rejected-option" | "outcome";

/** One part of a candidate, with the line it starts on (1-based, in its document). */
export interface Part { kind: PartKind; text: string; line: number }

export interface Candidate {
  /** The source document's id: one candidate per document. */
  id: string;
  kind: PostKind;
  title: string;
  document: TopicDocument;
  parts: Part[];
}

const DECISION = /^\s*(\d+)\.\s+\*\*(.+?)\*\*/u;
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.+)$/u;
const REJECTED_HEADING = /^#{2,4}\s+(options( considered| not taken)?|alternatives( considered)?|rejected)/iu;
const OUTCOME_HEADING = /^#{2,4}\s+(evidence|results?|outcome|what happened|consequences|post-?mortem)/iu;
const DECISION_HEADING = /^#{2,4}\s+(decisions?|what we want|resolved decisions)\b/iu;
const HEADING = /^#{1,4}\s/u;
const strip = (text: string) => text.replace(/\*\*/gu, "").trim();

/**
 * The parts of a decision document: numbered bold decisions anywhere outside the options and outcome sections, every list
 * item under a decision heading ("Decision", "What we want"), and list items under options and outcome headings.
 */
export function partsOf(document: TopicDocument): Part[] {
  const parts: Part[] = [];
  let section: PartKind | null = null;
  document.lines.forEach((line, index) => {
    if (HEADING.test(line)) {
      section = REJECTED_HEADING.test(line) ? "rejected-option" : OUTCOME_HEADING.test(line) ? "outcome"
        : DECISION_HEADING.test(line) ? "decision" : null;
      return;
    }
    const decision = DECISION.exec(line);
    if (decision && (section === null || section === "decision")) {
      parts.push({ kind: "decision", text: strip(decision[2]!), line: index + 1 });
      return;
    }
    const item = section ? LIST_ITEM.exec(line) : null;
    if (item && section) parts.push({ kind: section, text: strip(item[1]!).slice(0, 300), line: index + 1 });
  });
  return parts;
}

/** The post a document can become: decisions give decision posts; experiments, incidents and measured PRs post-mortems. */
export function candidateOf(document: TopicDocument): Candidate {
  const kind: PostKind = document.kind === "decision" ? "decision" : "post-mortem";
  const parts = kind === "decision" ? partsOf(document)
    : [{ kind: "outcome" as const, text: document.title, line: Math.max(1, document.lines.findIndex((l) => l.trim() !== "") + 1) }];
  return { id: document.id, kind, title: document.title, document, parts };
}

/** One candidate per document, in the order the documents came (ids are unique per document). */
export function candidatesOf(documents: TopicDocument[]): Candidate[] {
  const seen = new Set<string>();
  return documents.filter((document) => !seen.has(document.id) && seen.add(document.id)).map(candidateOf);
}
