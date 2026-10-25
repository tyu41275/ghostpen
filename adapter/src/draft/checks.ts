/**
 * Every check a draft must pass before Tim sees it (ADR 0101, brief D1–D3, D10, D14), in plain words. Each one fails the
 * draft on its own; the report says which failed and why, and which parts go on the "posts to write later" list. The
 * screenshot privacy check joins these with the screenshots (ghostpen#90, part 3).
 */
import type { PublishedIndex } from "../sources/published.js";
import { checkDiagrams, type StackGraph } from "./diagrams.js";
import { checkPlain, PLAIN_DEFAULTS, type PlainOptions } from "./plain.js";
import { checkStackParts } from "./stack-parts.js";

export interface CheckReport {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; findings: string[] }>;
  /** Central parts with no post: the draft waits for their background posts. */
  hold: string[];
  /** Parts explained in passing: posts to write later. */
  later: string[];
  grade: number;
}

export interface DraftInput { title: string; markdown: string }
export interface CheckContext { terms: string[]; index: PublishedIndex; graph: StackGraph | null; plain?: PlainOptions }

export function checkDraft(draft: DraftInput, context: CheckContext): CheckReport {
  const plain = checkPlain(draft.markdown, context.plain ?? PLAIN_DEFAULTS);
  const parts = checkStackParts(draft.title, draft.markdown, context.terms, context.index);
  const diagrams = checkDiagrams(draft.markdown, context.graph);
  const checks = [
    { name: "Plain words", passed: plain.passed, findings: plain.findings },
    { name: "Every stack part linked or explained", passed: parts.passed, findings: parts.findings },
    { name: "Diagrams match the stack map", passed: diagrams.passed, findings: diagrams.findings },
  ];
  return { passed: checks.every((c) => c.passed), checks, hold: parts.hold, later: parts.later, grade: plain.grade };
}

/** The report in plain words, for the draft's pull request and its card. */
export function reportText(report: CheckReport): string {
  const lines = [report.passed ? "All checks passed." : "Some checks failed; the draft is not ready.", `Reading grade: ${report.grade}.`];
  for (const check of report.checks) {
    lines.push(`${check.passed ? "✅" : "❌"} ${check.name}`);
    for (const finding of check.findings) lines.push(`   - ${finding}`);
  }
  if (report.hold.length) lines.push(`Waiting for background posts first: ${report.hold.join(", ")}.`);
  if (report.later.length) lines.push(`Posts to write later: ${report.later.join(", ")}.`);
  return lines.join("\n");
}
