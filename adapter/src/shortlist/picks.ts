/**
 * What a week's shortlist holds (ADR 0101, brief D13): the top candidates of the last ranking that Tim has not written
 * or skipped yet; one he answered "Not yet" comes back in a later week. When one part of the setup would need
 * explaining in two or more of them and no post explains it yet, its background post is ranked in first (brief D3, D7):
 * writing it lets those topics link to it.
 */
import type { ChoicesState } from "../ranking/choices.js";
import type { RankingView } from "../ranking/run.js";

export interface ShortlistItem {
  /** The candidate id, or `background:<part>` for a background post. */
  id: string;
  kind: "decision" | "post-mortem" | "background";
  text: string;
}

const FACTOR_WORDS: Record<string, string> = { stakes: "stakes", carryOver: "carry-over", thoughtProcess: "thinking",
  evidence: "evidence", surprise: "surprise", completeness: "completeness" };

type Entry = RankingView["entries"][number];

/** One proposal in plain words: the topic, why it ranked there, what a reader leaves with, and what it needs first. */
export function proposalText(entry: Entry, rank: number): string {
  const kind = entry.kind === "decision" ? "Decision post" : "Post-mortem";
  const best = entry.scores.filter((s) => s.line !== null && s.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  const why = best.length
    ? best.map((s) => `${FACTOR_WORDS[s.factor] ?? s.factor} ${s.score}/3: "${s.quote.slice(0, 160)}"`).join("; ")
    : "no factor scored above 0";
  const needs = entry.explain.length ? `Needs first: a post explaining ${entry.explain.slice(0, 4).join(", ")}${entry.explain.length > 4 ? ` and ${entry.explain.length - 4} more` : ""}.`
    : "Needs nothing explained first.";
  return [`**#${rank} ${entry.topic}** (${kind}, score ${entry.total})`, `Why: ${why}`,
    entry.takeaway ? `A reader leaves with: ${entry.takeaway}` : "", needs].filter(Boolean).join("\n");
}

/** The items for this week: up to `count`, a background post first when one unlocks two or more of the picks. */
export function picks(view: RankingView, choices: ChoicesState, count: number): ShortlistItem[] {
  const answered = new Set(choices.choices.filter((c) => c.choice !== "not-yet").map((c) => c.candidate));
  const open = view.entries.filter((e) => !answered.has(e.id));
  const top = open.slice(0, count);
  const topIds = new Set(top.map((e) => e.id));
  const background = view.background.find((b) => !answered.has(`background:${b.part}`) && b.unlocks.filter((id) => topIds.has(id)).length >= 2);
  const items: ShortlistItem[] = [];
  if (background) {
    const unlocked = background.unlocks.filter((id) => topIds.has(id)).length;
    items.push({ id: `background:${background.part}`, kind: "background",
      text: `**Background post: what ${background.part} is**\nWhy: ${unlocked} of this week's topics mention ${background.part}, and no post explains it yet. Writing this first lets them link to it instead of explaining it again.` });
  }
  for (const [i, entry] of open.slice(0, count - items.length).entries()) items.push({ id: entry.id, kind: entry.kind as "decision" | "post-mortem", text: proposalText(entry, i + 1) });
  return items;
}
