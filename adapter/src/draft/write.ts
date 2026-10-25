/**
 * Drafting one post (ADR 0101, brief D1–D3, D10–D12): gather what the writer needs from the sources, run the writer, run
 * every check, and send a failed draft back with the check report up to `draft.revisions` times. A draft held for a
 * background post stops at once: rewording cannot write that post. Every draft is kept in `dataDir/drafts/` with its
 * report, ready, held or failed; nothing is published from here (Tim approves every post, brief D14).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { candidatesOf } from "../ranking/candidates.js";
import { isRankingView, RANKING_FILE } from "../ranking/run.js";
import { runScorer } from "../ranking/scorer.js";
import type { GhostpenSettings } from "../settings.js";
import { frontmatter, postsAbout } from "../sources/published.js";
import { readSources, type SourcesRead } from "../sources/read.js";
import type { TopicDocument } from "../sources/types.js";
import { checkDraft, type CheckReport } from "./checks.js";
import type { StackGraph } from "./diagrams.js";
import { editPrompt, parseWritten, revisePrompt, writerPrompt, type DraftKind, type PartBrief, type WriterBrief, type Written } from "./prompt.js";
import { playwrightCapture, screenshotRefs, takeScreenshots, type Capturer } from "./screenshots.js";
import { readStackMap } from "./stack-map.js";

export const DRAFTS_DIR = "drafts";
const BACKGROUND = "background:";
const MAX_BACKGROUND_DOCUMENTS = 3;

export interface Draft extends Written {
  /** The shortlist id it was drafted for: a candidate id, or `background:<part>`. */
  id: string;
  kind: DraftKind;
  status: "ready" | "held" | "failed";
  report: CheckReport;
  attempts: number;
  madeAt: string;
  /** What could not be read (sources, the stack map), shown with the draft. */
  problems: string[];
  /** The screenshots taken, by name: their files. */
  screenshots: Record<string, string>;
}

export interface DraftSeams { write?: (prompt: string) => Promise<string>; stackMap?: (prompt: string) => Promise<string>; capture?: Capturer; now?: Date }

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const mentions = (text: string, term: string) =>
  (text.match(new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term)}(?=$|[^A-Za-z0-9])`, "giu")) ?? []).length;

/** Where a draft is kept: readable, and unique per id. */
export function draftFile(dataDir: string, id: string): string {
  const name = `${id.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80)}-${createHash("sha256").update(id).digest("hex").slice(0, 8)}.json`;
  return join(dataDir, DRAFTS_DIR, name);
}

export function readDraft(dataDir: string, id: string): Draft | null {
  const path = draftFile(dataDir, id);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Draft : null;
}

/** The documents a draft is written from, its kind and subject. */
function target(read: SourcesRead, id: string): { kind: DraftKind; subject: string; documents: TopicDocument[]; definition?: string } {
  if (id.startsWith(BACKGROUND)) {
    const part = id.slice(BACKGROUND.length).trim();
    const definition = read.definitions.find((d) => d.term.toLowerCase() === part.toLowerCase());
    const documents = read.documents.map((d) => ({ d, n: mentions(d.lines.join("\n"), part) })).filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n).slice(0, MAX_BACKGROUND_DOCUMENTS).map((x) => x.d);
    if (!definition && documents.length === 0) throw new Error(`nothing in the sources defines or names ${part}`);
    return { kind: "background", subject: definition?.term ?? part, documents, ...(definition ? { definition: definition.text } : {}) };
  }
  const candidate = candidatesOf(read.documents).find((c) => c.id === id);
  if (!candidate) throw new Error(`no source document has the id ${id}`);
  return { kind: candidate.kind, subject: candidate.title, documents: [candidate.document] };
}

/** The stack map cut, for the prompt, to the arrows touching a part named and the parts at their ends. */
function cut(graph: StackGraph | null, parts: string[]): StackGraph | null {
  if (!graph) return null;
  const wanted = new Set(parts.map((p) => p.toLowerCase()));
  const named = new Set(graph.nodes.filter((n) => wanted.has(n.label.toLowerCase())).map((n) => n.id));
  const edges = graph.edges.filter((e) => named.has(e.from) || named.has(e.to));
  const ends = new Set(edges.flatMap((e) => [e.from, e.to]));
  return { nodes: graph.nodes.filter((n) => ends.has(n.id)), edges };
}

/** Recent published posts the author wrote themself (not `aiGenerated`), for the voice. */
function voice(settings: GhostpenSettings, read: SourcesRead, count: number): WriterBrief["voice"] {
  const blogDir = settings.sources.published?.blogDir;
  if (!blogDir || count === 0) return [];
  const out: WriterBrief["voice"] = [];
  for (const post of [...read.index.posts].filter((p) => !p.draft).sort((a, b) => b.date.localeCompare(a.date))) {
    if (out.length >= count) break;
    try {
      const { fields, body } = frontmatter(readFileSync(join(blogDir, post.file), "utf8"));
      if (fields.aiGenerated !== "true") out.push({ title: post.title, body });
    } catch { /* an unreadable post is left out */ }
  }
  return out;
}

/** `edit`: the author's changes to an earlier draft (an Edit press); the writer starts from that draft. */
export async function draftNow(settings: GhostpenSettings, id: string, seams: DraftSeams = {}, edit?: { previous: Written; notes: string }): Promise<Draft> {
  const draft = settings.draft;
  if (!draft) throw new Error("no draft writer is set (settings.draft)");
  const read = await readSources(settings, seams.now);
  const goal = target(read, id);
  const text = [goal.definition ?? "", ...goal.documents.map((d) => d.lines.join("\n"))].join("\n");
  const definitionOf = new Map(read.definitions.map((d) => [d.term.toLowerCase(), d.text]));
  const named = [...new Set(read.terms)].filter((t) => t.trim().length >= 2 && t.toLowerCase() !== goal.subject.toLowerCase() && mentions(text, t) > 0);
  const parts: PartBrief[] = named.map((term) => {
    const post = postsAbout(read.index, term)[0];
    return post ? { term, post: { url: post.url, title: post.title } } : { term, ...(definitionOf.has(term.toLowerCase()) ? { definition: definitionOf.get(term.toLowerCase())! } : {}) };
  });
  const map = await readStackMap(draft.stackMap, seams.stackMap);
  const rankingPath = join(settings.dataDir, RANKING_FILE);
  const ranking = existsSync(rankingPath) ? JSON.parse(readFileSync(rankingPath, "utf8")) as unknown : null;
  const entry = isRankingView(ranking) ? ranking.entries.find((e) => e.id === id) : undefined;
  const brief: WriterBrief = { kind: goal.kind, subject: goal.subject, documents: goal.documents, parts,
    graph: cut(map.graph, [goal.subject, ...named]), voice: voice(settings, read, draft.voicePosts),
    ...(entry ? { topic: entry.topic, takeaway: entry.takeaway } : {}),
    ...(draft.styleGuide ? { styleGuide: readFileSync(draft.styleGuide, "utf8") } : {}),
    ...(draft.screenshots ? { screenshots: draft.screenshots.pages.map((p) => ({ name: p.name, description: p.description })) } : {}) };
  const write = seams.write ?? ((prompt: string) => runScorer(draft.writer, prompt, "draft writer"));
  const context = { terms: read.terms, index: read.index, graph: map.graph, ...(goal.kind === "background" ? { subject: goal.subject } : {}) };
  let written = parseWritten(await write(edit ? editPrompt(brief, edit.previous, edit.notes) : writerPrompt(brief)));
  let report = checkDraft(written, context);
  let attempts = 1;
  const problems = [...read.problems.map((p) => `${p.source}: ${p.problem}`), ...(map.problem ? [`stack map: ${map.problem}`] : [])];
  while (!report.passed && report.hold.length === 0 && attempts <= draft.revisions) {
    try {
      written = parseWritten(await write(revisePrompt(brief, written, report)));
    } catch (error) {
      // The last draft and its report are kept; the failed revision is said, never hidden.
      problems.push(`revision ${attempts}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    report = checkDraft(written, context);
    attempts += 1;
  }
  // Screenshots are taken once the words pass: a draft that still fails or waits needs none yet.
  // An earlier run's pictures never outlive it: this run keeps only what it takes itself.
  const shotsDir = `${draftFile(settings.dataDir, id).replace(/\.json$/u, "")}-shots`;
  rmSync(shotsDir, { recursive: true, force: true });
  let screenshots: Record<string, string> = {};
  if (report.passed && screenshotRefs(written.markdown).length) {
    const shots = await takeScreenshots(written.markdown, draft.screenshots, shotsDir, seams.capture ?? playwrightCapture);
    screenshots = shots.files;
    report = { ...report, passed: shots.passed, checks: [...report.checks, { name: "Screenshots show nothing private", passed: shots.passed, findings: shots.findings }] };
  }
  const result: Draft = { id, kind: goal.kind, ...written, status: report.passed ? "ready" : report.hold.length ? "held" : "failed", report, attempts,
    madeAt: (seams.now ?? new Date()).toISOString(), problems, screenshots };
  const path = draftFile(settings.dataDir, id);
  mkdirSync(join(settings.dataDir, DRAFTS_DIR), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(result, null, 2));
  renameSync(`${path}.tmp`, path);
  return result;
}
