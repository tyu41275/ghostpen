/**
 * What the draft writer is told (ADR 0101, brief D1–D3, D10, D12). The plain-words rule comes first, ahead of the voice:
 * a 10-year-old must be able to follow every sentence. Then the stack parts the sources name, each with the post to
 * link or the definition to explain it from, the stack map's arrows a diagram may draw, the author's style guide and
 * recent posts for the voice, and the source documents. A failed draft goes back with the check report.
 */
import type { TopicDocument } from "../sources/types.js";
import type { CheckReport } from "./checks.js";
import type { StackGraph } from "./diagrams.js";

export type DraftKind = "decision" | "post-mortem" | "background";
export interface PartBrief { term: string; post?: { url: string; title: string }; definition?: string }
export interface WriterBrief {
  kind: DraftKind;
  /** The source document's title, or the stack part a background post explains. */
  subject: string;
  topic?: string;
  takeaway?: string;
  documents: TopicDocument[];
  parts: PartBrief[];
  /** The stack map cut to the parts named; null when there is none. */
  graph: StackGraph | null;
  styleGuide?: string;
  voice: Array<{ title: string; body: string }>;
  /** Pages the writer may screenshot, by name, with what each shows. */
  screenshots?: Array<{ name: string; description: string }>;
}
/** What the writer answers: one JSON object. */
export interface Written { title: string; summary: string; tags: string[]; markdown: string }

const MAX_DOCUMENT_LINES = 400;
const MAX_VOICE_LINES = 120;

const KIND: Record<DraftKind, string> = {
  decision: "a decision post: what had to be decided and why it mattered, the real options, and why the winner won. If the outcome is not known yet, say so plainly: a follow-up post will tell how it turned out.",
  "post-mortem": "a post-mortem: what was expected, what actually happened (with the numbers the sources give), what was surprising, and what changed because of it.",
  background: "a background post: what this part of the setup is, what it does, why it exists and how it fits with the parts around it, so later posts can link here instead of explaining it again.",
};

function partLines(parts: PartBrief[]): string[] {
  if (parts.length === 0) return ["The sources name no part of the author's setup."];
  return parts.map((p) => p.post ? `- ${p.term}: a post explains it. Link it where it first appears: [${p.term}](${p.post.url})`
    : `- ${p.term}: no post explains it. Where it first appears, say what it is in a few plain words, like "${p.term}, a ...". Its definition: ${(p.definition ?? "none given").replace(/\s+/gu, " ").slice(0, 400)}`);
}

function graphLines(graph: StackGraph | null): string[] {
  if (!graph) return ["Draw no diagram of the setup: there is no stack map to check it against."];
  if (graph.edges.length === 0) return ["Draw no diagram of the setup: the stack map has no arrows for these parts."];
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return ["You may add one Mermaid flowchart (```mermaid) of the setup. Draw only these arrows, between boxes labelled with these names:",
    ...graph.edges.map((e) => `- ${label.get(e.from) ?? e.from} --> ${label.get(e.to) ?? e.to}`)];
}

export function writerPrompt(brief: WriterBrief): string {
  const documents = brief.documents.flatMap((d) => [`### ${d.title}`, ...d.lines.slice(0, MAX_DOCUMENT_LINES), ""]);
  return [
    `You write one blog post: ${KIND[brief.kind]}`,
    `It is about: ${brief.topic ?? brief.subject}.`, brief.takeaway ? `A reader should leave with: ${brief.takeaway}` : "",
    "",
    "THE FIRST RULE: a 10-year-old must be able to follow every sentence. Short sentences (never more than 30 words), everyday words,",
    "and every word a 10-year-old would not know explained the first time it appears. A reader who knows nothing about the author's setup",
    "must never be left guessing what something is.",
    "",
    "Parts of the author's setup the sources name:", ...partLines(brief.parts),
    "",
    ...graphLines(brief.graph),
    "",
    ...(brief.screenshots?.length
      ? ["You may add screenshots of these pages, written `![<what it shows, in plain words>](screenshot:<name>)`:",
        ...brief.screenshots.map((s) => `- ${s.name}: ${s.description}`)]
      : ["Add no screenshots or images."]),
    "",
    "Use only facts from the source documents. Do not invent numbers, names or events.",
    brief.styleGuide ? `\nThe author's style guide (the first rule above wins where they differ):\n${brief.styleGuide}` : "",
    ...brief.voice.map((v) => `\nOne of the author's posts, for the voice only (not for facts): ${v.title}\n${v.body.split("\n").slice(0, MAX_VOICE_LINES).join("\n")}`),
    "",
    "Answer with one JSON object and nothing else:",
    '{"title": "<plain title>", "summary": "<one plain sentence>", "tags": ["<lower-case tag>"], "markdown": "<the post body in markdown, no frontmatter>"}',
    "",
    "Source documents:", ...documents,
  ].filter((line) => line !== "").join("\n");
}

export function revisePrompt(brief: WriterBrief, previous: Written, report: CheckReport): string {
  const findings = report.checks.filter((c) => !c.passed).flatMap((c) => [`${c.name}:`, ...c.findings.map((f) => `- ${f}`)]);
  return [writerPrompt(brief), "", "Your last draft failed these checks. Fix every one and answer the whole post again, in the same JSON shape:",
    ...findings, "", "Your last draft:", JSON.stringify(previous)].join("\n");
}

/** The author's changes to a draft (an Edit press): the whole brief again, the draft, and what to change. */
export function editPrompt(brief: WriterBrief, previous: Written, notes: string): string {
  return [writerPrompt(brief), "", "The author read your draft and asked for these changes. Make them, keep every rule above, and answer the whole",
    "post again, in the same JSON shape:", notes.trim(), "", "Your draft:", JSON.stringify(previous)].join("\n");
}

const text = (value: unknown, field: string, max: number): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`the writer's answer has no ${field}`);
  return value.trim().slice(0, max);
};

/** The writer's answer: the first JSON object in its output (a model may wrap it in a code fence), checked. */
export function parseWritten(output: string): Written {
  const start = output.indexOf("{"), end = output.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the writer answered no JSON object");
  let value: Record<string, unknown>;
  try { value = JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>; } catch { throw new Error("the writer's answer is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("the writer answered something other than an object");
  const tags = Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/u.test(t)).slice(0, 6) : [];
  return { title: text(value.title, "title", 200).split("\n")[0]!, summary: text(value.summary, "summary", 400).split("\n")[0]!, tags,
    markdown: text(value.markdown, "markdown", 100_000) };
}
