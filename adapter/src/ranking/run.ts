/**
 * One ranking run (ADR 0101): read every configured source, make the candidates, score the changed ones, rank them, and
 * keep the result in `dataDir/ranking.json` for the app page and the weekly shortlist. Every source problem and every
 * scorer failure is kept with the result, shown to the operator, never hidden.
 */
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GhostpenSettings } from "../settings.js";
import { readSources } from "../sources/read.js";
import type { TopicDocument } from "../sources/types.js";
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

const str = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown) => Array.isArray(v) && v.every(str);
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Whether `value` is a whole ranking, every entry, score, background post and booking of the right shape. */
export function isRankingView(value: unknown): value is RankingView {
  if (!rec(value) || !str(value.ranAt) || !strs(value.problems)) return false;
  const score = (s: unknown) => rec(s) && str(s.factor) && typeof s.score === "number" && str(s.quote) && str(s.location)
    && (s.line === null || typeof s.line === "number") && (s.note === undefined || str(s.note));
  const entry = (e: unknown) => rec(e) && [e.id, e.kind, e.title, e.topic, e.takeaway, e.location].every(str)
    && typeof e.total === "number" && strs(e.explain) && Array.isArray(e.scores) && e.scores.every(score);
  const background = (b: unknown) => rec(b) && str(b.part) && strs(b.unlocks);
  const owed = (o: unknown) => rec(o) && str(o.decision) && str(o.title) && str(o.bookedAt) && typeof o.due === "boolean" && strs(o.evidence);
  return Array.isArray(value.entries) && value.entries.every(entry) && Array.isArray(value.background) && value.background.every(background)
    && Array.isArray(value.owed) && value.owed.every(owed);
}

/** Where a line of a document is, as the operator can open it: `path:line` or the web address. */
const where = (document: TopicDocument, line: number | null) =>
  document.location.url ?? `${document.location.path ?? document.id}${line ? `:${line}` : ""}`;

export async function rankNow(settings: GhostpenSettings, seams: { run?: (prompt: string) => Promise<string>; now?: Date } = {}):
  Promise<RankingView> {
  const { documents, terms, index, problems } = await readSources(settings, seams.now);
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
