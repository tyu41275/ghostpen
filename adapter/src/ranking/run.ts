/**
 * One ranking run (ADR 0101): read every configured source, make the candidates, score the changed ones, rank them, and
 * keep the result in `dataDir/ranking.json` for the app page and the weekly shortlist. Every source problem and every
 * scorer failure is kept with the result, shown to the operator, never hidden.
 */
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GhostpenSettings } from "../settings.js";
import { liveGithubGet, readGithubTopics } from "../sources/github.js";
import { readGlossaries, readMarkdownTopics } from "../sources/markdown.js";
import { buildPublishedIndex, type PublishedIndex } from "../sources/published.js";
import type { Definition, SourceProblem, TopicDocument } from "../sources/types.js";
import { candidatesOf } from "./candidates.js";
import { readChoices } from "./choices.js";
import { rank, type BackgroundPost, type OwedPostMortem } from "./rank.js";
import type { Score } from "./scores.js";
import { scoreAll, type Scored } from "./scorer.js";

export const RANKING_FILE = "ranking.json";

/** What the app page and the shortlist read: plain data, every value a string, number or list. */
export interface RankingView {
  ranAt: string;
  entries: Array<{ id: string; kind: string; title: string; topic: string; takeaway: string; total: number; explain: string[];
    location: string; scores: Array<Score & { location: string }> }>;
  background: BackgroundPost[];
  owed: OwedPostMortem[];
  problems: string[];
}

/** Where a line of a document is, as the operator can open it: `path:line` or the web address. */
const where = (document: TopicDocument, line: number | null) =>
  document.location.url ?? `${document.location.path ?? document.id}${line ? `:${line}` : ""}`;

export async function rankNow(settings: GhostpenSettings, seams: { run?: (prompt: string) => Promise<string>; now?: Date } = {}):
  Promise<RankingView> {
  const problems: SourceProblem[] = [];
  const documents: TopicDocument[] = [];
  for (const source of settings.sources.topics) {
    const read = source.kind === "markdown" ? readMarkdownTopics(source) : await readGithubTopics(source, liveGithubGet(source), seams.now);
    documents.push(...read.items);
    problems.push(...read.problems);
  }
  const definitions: Definition[] = [];
  for (const source of settings.sources.references) {
    const read = readGlossaries(source);
    definitions.push(...read.items);
    problems.push(...read.problems);
  }
  const terms = definitions.map((d) => d.term);
  let index: PublishedIndex = { version: 1, terms: "", posts: [] };
  if (settings.sources.published) {
    const built = buildPublishedIndex(settings.sources.published, terms, settings.dataDir);
    index = built.index;
    problems.push(...built.problems);
  }
  const candidates = candidatesOf(documents);
  let scored = new Map<string, Scored>();
  const notes = problems.map((p) => `${p.source}: ${p.problem}`);
  if (!settings.scorer) notes.push("no scorer is set (settings.scorer): nothing is ranked");
  else {
    const result = await scoreAll(candidates, settings.scorer, settings.dataDir, seams.run);
    scored = result.scored;
    notes.push(...result.failures.map((f) => `scorer: ${f.candidate}: ${f.problem}`));
  }
  const choices = readChoices(settings.dataDir);
  const ranking = rank(candidates, new Map([...scored].map(([id, s]) => [id, s.scores])), choices.weights, terms, index, choices.bookings);
  const view: RankingView = {
    ranAt: (seams.now ?? new Date()).toISOString(),
    entries: ranking.ranked.map((r) => ({ id: r.candidate.id, kind: r.candidate.kind, title: r.candidate.title,
      topic: scored.get(r.candidate.id)!.topic, takeaway: scored.get(r.candidate.id)!.takeaway, total: r.total, explain: r.explain,
      location: where(r.candidate.document, 1), scores: r.scores.map((s) => ({ ...s, location: where(r.candidate.document, s.line) })) })),
    background: ranking.background, owed: ranking.owed, problems: notes };
  const path = join(settings.dataDir, RANKING_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(view, null, 2));
  renameSync(`${path}.tmp`, path);
  return view;
}
