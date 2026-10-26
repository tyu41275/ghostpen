import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateOf, candidatesOf, partsOf } from "../src/ranking/candidates.js";
import { applyWeights, CHOICES_FILE, readChoices, recordChoice, suggestWeights } from "../src/ranking/choices.js";
import { explanationCost, naming, owedPostMortems, rank, TOP } from "../src/ranking/rank.js";
import type { Definition } from "../src/sources/types.js";
import { checkScores, DEFAULT_WEIGHTS, total } from "../src/ranking/scores.js";
import type { PublishedIndex } from "../src/sources/published.js";
import type { TopicDocument } from "../src/sources/types.js";
import { tempDir } from "./helpers.js";

const doc = (id: string, lines: string[], over: Partial<TopicDocument> = {}): TopicDocument =>
  ({ id, kind: "decision", source: "decisions", title: lines[0]!.replace(/^# /u, ""), lines, location: { path: `/o/${id}.md`, line: 1 }, ...over });

const ADR = doc("dh/0022-live-trading-parity", ["# ADR 0022: Diamond Hands live trading parity policy", "", "## Context",
  "Paper and live must make the same decisions.", "", "## Options considered", "1. **Match returns.** Rejected: noisy.",
  "- Separate rule sets per mode", "", "## Decision", "1. **Match decisions, not returns.**", "2. **Never round risk up.**",
  "", "## Consequences", "- Real-money trading waits for a parity check", "- chatter shows a Relay card"]);
const EMPTY_INDEX: PublishedIndex = { version: 1, terms: "", posts: [] };
const def = (term: string, text: string, path = `/g/${term.toLowerCase()}/docs/CONTEXT.md`, line = 5): Definition =>
  ({ term, text, location: { path, line }, source: "glossaries" });
const GLOSSARY = [def("chatter", "The Discord bot."), def("Relay", "The fleet's deploy and promotion tool.\nIt runs on always-on-dev."), def("Tempo", "Delivery metrics.")];

describe("candidates", () => {
  it("one per document: its decisions, the options it turned down and what it says happened, each with its line", () => {
    expect(partsOf(ADR)).toEqual([
      { kind: "rejected-option", text: "Match returns. Rejected: noisy.", line: 7 },
      { kind: "rejected-option", text: "Separate rule sets per mode", line: 8 },
      { kind: "decision", text: "Match decisions, not returns.", line: 11 },
      { kind: "decision", text: "Never round risk up.", line: 12 },
      { kind: "outcome", text: "Real-money trading waits for a parity check", line: 15 },
      { kind: "outcome", text: "chatter shows a Relay card", line: 16 }]);
    // An ADR whose decisions are bullets under "## Decision" gives them as decisions too.
    expect(partsOf(doc("x", ["# ADR", "## Decision", "Option 3.", "- **Declaration.** Each instance gets one.", "- Relay acts on it."])))
      .toEqual([{ kind: "decision", text: "Declaration. Each instance gets one.", line: 4 }, { kind: "decision", text: "Relay acts on it.", line: 5 }]);
    // A decision not yet run is a decision post now (D5), never held back.
    expect(candidateOf(ADR).kind).toBe("decision");
    const experiment = doc("exp/compaction", ["# Compaction trial", "", "Cost per step fell 28%."], { kind: "experiment" });
    expect(candidateOf(experiment)).toMatchObject({ kind: "post-mortem", parts: [{ kind: "outcome", text: "Compaction trial", line: 1 }] });
    const twice = candidatesOf([ADR, ADR, experiment]);
    expect(twice.map((c) => c.id)).toEqual(["dh/0022-live-trading-parity", "exp/compaction"]); // never two places for one document
  });
});

describe("scores", () => {
  const candidate = candidateOf(ADR);
  it("keeps a score only with a quote the source holds word for word; anything else is 0, saying why", () => {
    const scores = checkScores(candidate, {
      stakes: { score: 3, quote: "Real-money   trading waits for a parity check" }, // whitespace does not matter
      carryOver: { score: 2, quote: "Never round risk up, ever" }, // not in the source
      thoughtProcess: { score: 5, quote: "Match returns." } });
    expect(scores).toEqual([
      { factor: "stakes", score: 3, quote: "Real-money   trading waits for a parity check", line: 15 },
      { factor: "carryOver", score: 0, quote: "Never round risk up, ever", line: null, note: "its quote is not in the source" },
      { factor: "thoughtProcess", score: 0, quote: "Match returns.", line: null, note: "no score from 0 to 3 was given" }]);
    expect(checkScores(candidate, { stakes: { score: 2, quote: "risk" } })[0]).toMatchObject({ score: 0, note: "its quote is not in the source" }); // too short to prove
    for (const score of [4, -1, 1.5]) { // just past each edge, and a fraction
      expect(checkScores(candidate, { stakes: { score, quote: "Real-money trading waits for a parity check" } })[0])
        .toMatchObject({ score: 0, note: "no score from 0 to 3 was given" });
    }
    expect(checkScores(candidate, { stakes: { score: 3, quote: "Real-money trading waits for a parity check" } })[0]).toMatchObject({ score: 3 });
    expect(total(scores)).toBe(3);
    expect(total(scores, { ...DEFAULT_WEIGHTS, stakes: 2 })).toBe(6);
  });

  it("scores a post-mortem on evidence, surprise and completeness, never a decision post's factors", () => {
    const pm = candidateOf(doc("exp/x", ["# Trial", "Cost per step fell 28% against the baseline."], { kind: "experiment" }));
    expect(checkScores(pm, { stakes: { score: 3, quote: "Cost per step fell 28%" } }).map((s) => s.factor)).toEqual(["evidence", "surprise", "completeness"]);
  });
});

describe("the ranking", () => {
  const index: PublishedIndex = { version: 1, terms: "", posts: [{ file: "c.mdx", hash: "", url: "https://x/blog/c", title: "Chatter",
    date: "2026-03-01", tags: [], draft: false, about: ["chatter"], mentions: [] }] };
  it("orders by weighted total, lists what needs explaining (never lowering a score), and orders background posts by what they unlock", () => {
    const a = candidateOf(ADR); // names Relay once, in passing: no cost (ghostpen#111)
    const b = candidateOf(doc("relay/0024", ["# ADR 0024: stacks in Relay", "Relay and Tempo and chatter.", "Big change across the fleet here."]));
    const c = candidateOf(doc("tempo/0031", ["# ADR 0031: delivery metrics", "Tempo grades each task.", "Tempo keeps the baseline.", "Tempo shows history."]));
    const scored = new Map([[a.id, checkScores(a, { stakes: { score: 2, quote: "Real-money trading waits for a parity check" } })],
      [b.id, checkScores(b, { stakes: { score: 3, quote: "Big change across the fleet here." } })],
      [c.id, checkScores(c, { stakes: { score: 1, quote: "Tempo grades each task." } })]]);
    const ranking = rank([a, b, c], scored, DEFAULT_WEIGHTS, GLOSSARY, index);
    // relay is in b's title and tempo is named three times in c: central. chatter has a post: not explained again.
    expect(ranking.ranked.map((r) => [r.candidate.id, r.total, r.explain])).toEqual([
      ["relay/0024", 3, ["relay"]], ["dh/0022-live-trading-parity", 2, []], ["tempo/0031", 1, ["tempo"]]]);
    // Each background post carries its references: where the part is defined (first sentence) and the line that names it.
    expect(ranking.background).toEqual([
      { part: "relay", unlocks: ["relay/0024"], mentions: [{ id: "relay/0024", line: 1, quote: "# ADR 0024: stacks in Relay" }],
        defined: [{ where: "/g/relay/docs/CONTEXT.md:5", text: "The fleet's deploy and promotion tool." }] },
      { part: "tempo", unlocks: ["tempo/0031"], mentions: [{ id: "tempo/0031", line: 2, quote: "Tempo grades each task." }],
        defined: [{ where: "/g/tempo/docs/CONTEXT.md:5", text: "Delivery metrics." }] }]);
    expect(ranking.problems).toEqual([]);
    expect(TOP).toBe(15);
  });

  it("counts a part only where the document uses it as one: in its title, or named three times or more", () => {
    expect(naming(ADR, "relay")).toEqual({ count: 1, central: false, line: 16, quote: "- chatter shows a Relay card" });
    expect(naming(ADR, "Diamond Hands")).toEqual({ count: 1, central: true, line: 1, quote: "# ADR 0022: Diamond Hands live trading parity policy" });
    expect(naming(ADR, "parity")).toMatchObject({ count: 2, central: true, line: 1 }); // in the title: central at any count, quoted from it
    expect(naming(ADR, "paritys")).toBeNull(); // whole words only
    expect(explanationCost(candidateOf(ADR), ["chatter", "relay", "parity"], EMPTY_INDEX)).toEqual(["parity"]);
    const twice = candidateOf(doc("x/1", ["# ADR 1: a title", "The candidate build. A candidate again.", "nothing more"]));
    expect(explanationCost(twice, ["candidate"], EMPTY_INDEX)).toEqual([]); // two passing mentions are still passing
  });

  it("counts only prose, as the draft check does: not code, front matter, subheadings, tables or inline code", () => {
    const noisy = candidateOf(doc("x/2", ["---", "candidate: front matter", "---", "# ADR 2: a title", "## The candidate step",
      "```", "candidate = pick(candidate)", "candidate.run()", "```", "| candidate | yes |", "Use `candidate` here: see [candidate](https://x/candidate).",
      ">", "One candidate in prose."], { title: "ADR 2: a title" }));
    expect(naming(noisy.document, "candidate")).toEqual({ count: 2, central: false, line: 11, quote: "Use `candidate` here: see [candidate](https://x/candidate)." });
    expect(explanationCost(noisy, ["candidate"], EMPTY_INDEX)).toEqual([]);
    const prose = candidateOf(doc("x/3", ["# ADR 3: a title", "```", "candidate", "```", "A candidate.", "The candidate.", "That candidate."]));
    expect(naming(prose.document, "candidate")).toMatchObject({ count: 3, central: true, line: 5 });
    // A part in the title is cited from the title's own heading line, after any front matter; a title held by no line is quoted itself.
    const fronted = doc("x/4", ["---", "tags: [candidate]", "---", "# ADR 4: the candidate build", "Nothing else."], { title: "ADR 4: the candidate build" });
    expect(naming(fronted, "candidate")).toEqual({ count: 1, central: true, line: 4, quote: "# ADR 4: the candidate build" });
    const issue = doc("gh:o/r#1", ["Body with no heading."], { title: "The candidate build", kind: "issue" });
    expect(naming(issue, "candidate")).toEqual({ count: 1, central: true, line: 1, quote: "The candidate build" });
  });

  it("counts a term two glossaries define differently for no topic and reports it, while one definition copied twice is one", () => {
    const build = candidateOf(doc("relay/0005", ["# ADR 0005: the candidate build", "What a candidate is here."]));
    const scored = new Map([[build.id, checkScores(build, { stakes: { score: 2, quote: "What a candidate is here." } })]]);
    const clash = [def("Candidate", "A possible post, built from one document.", "/g/ghostpen/docs/CONTEXT.md", 25),
      def("Candidate", "A discretionary trade proposal produced by a scan.", "/g/diamond-hands/docs/CONTEXT.md", 42)];
    const ranking = rank([build], scored, DEFAULT_WEIGHTS, clash, EMPTY_INDEX);
    expect(ranking.ranked[0]!.explain).toEqual([]);
    expect(ranking.background).toEqual([]);
    expect(ranking.problems).toEqual(['glossaries: "candidate" is defined differently at /g/ghostpen/docs/CONTEXT.md:25 and /g/diamond-hands/docs/CONTEXT.md:42: '
      + "it counts for no topic and no background post is proposed for it until one definition wins"]);
    const copied = [clash[0]!, def("candidate", "A possible  post,\nbuilt from one document.", "/g/other/docs/CONTEXT.md", 9)];
    const same = rank([build], scored, DEFAULT_WEIGHTS, copied, EMPTY_INDEX);
    expect(same.ranked[0]!.explain).toEqual(["candidate"]);
    expect(same.background[0]).toMatchObject({ part: "candidate", defined: [{ where: "/g/ghostpen/docs/CONTEXT.md:25", text: "A possible post, built from one document." },
      { where: "/g/other/docs/CONTEXT.md:9", text: "A possible post, built from one document." }] });
    expect(same.problems).toEqual([]);
  });

  it("books a post-mortem for a decision post and marks it due once a source shows the outcome", () => {
    const decision = candidateOf(ADR);
    const booking = { decision: decision.id, title: decision.title, bookedAt: "2026-10-24T00:00:00Z" };
    const unrelated = candidateOf(doc("gh:o/r#5", ["# other", "nothing"], { kind: "issue" }));
    expect(owedPostMortems([booking], [decision, unrelated])).toEqual([{ ...booking, due: false, evidence: [] }]);
    const lookalike = candidateOf(doc("gh:o/r#6", ["# other ADR", "Per ADR 00220 and 0022-live-trading-parity-v2 nothing."], { kind: "issue" }));
    expect(owedPostMortems([booking], [decision, lookalike])[0]).toMatchObject({ due: false, evidence: [] }); // whole tokens only
    const outcome = candidateOf(doc("gh:o/r#9", ["# First live week", "Per ADR 0022 the decisions matched."], { kind: "issue" }));
    expect(owedPostMortems([booking], [decision, outcome])[0]).toMatchObject({ due: true, evidence: ["gh:o/r#9"] });
    const byFile = candidateOf(doc("exp/live", ["# Live week", "See 0022-live-trading-parity.md for the rules."], { kind: "experiment" }));
    expect(owedPostMortems([booking], [decision, byFile])[0]).toMatchObject({ due: true, evidence: ["exp/live"] });
  });
});

describe("Tim's choices", () => {
  const s = (stakes: number, carryOver: number) => [{ factor: "stakes", score: stakes, quote: "q", line: 1 }, { factor: "carryOver", score: carryOver, quote: "q", line: 1 }];
  it("keeps each choice, needs a reason for a Skip, and books a post-mortem when a decision post is written", () => {
    const dir = tempDir();
    expect(() => recordChoice(dir, { candidate: "a", choice: "skip", reason: "  ", scores: [] }, "decision", "A")).toThrow("a Skip needs a one-line reason");
    recordChoice(dir, { candidate: "a", choice: "write", reason: "", scores: s(3, 1) }, "decision", "A", new Date("2026-10-24T01:00:00Z"));
    recordChoice(dir, { candidate: "a", choice: "write", reason: "", scores: s(3, 1) }, "decision", "A"); // booked once
    recordChoice(dir, { candidate: "p", choice: "write", reason: "", scores: [] }, "post-mortem", "P");
    recordChoice(dir, { candidate: "b", choice: "skip", reason: "too narrow\nsecond line dropped", scores: s(1, 1) }, "decision", "B");
    const state = readChoices(dir);
    expect(state.bookings).toEqual([{ decision: "a", title: "A", bookedAt: "2026-10-24T01:00:00.000Z" }]);
    expect(state.choices.map((c) => [c.candidate, c.choice, c.reason])).toEqual([["a", "write", ""], ["a", "write", ""], ["p", "write", ""], ["b", "skip", "too narrow"]]);
  });

  it("suggests weights from what Tim writes and skips, and changes nothing until he agrees", () => {
    const dir = tempDir();
    recordChoice(dir, { candidate: "a", choice: "write", reason: "", scores: s(3, 1) }, "decision", "A");
    expect(suggestWeights(readChoices(dir))).toEqual([]); // nothing skipped yet: nothing to learn
    recordChoice(dir, { candidate: "b", choice: "skip", reason: "low stakes", scores: s(0, 1) }, "decision", "B");
    recordChoice(dir, { candidate: "c", choice: "not-yet", reason: "", scores: s(0, 3) }, "decision", "C"); // teaches nothing
    const suggested = suggestWeights(readChoices(dir));
    expect(suggested).toEqual([{ factor: "stakes", from: 1, to: 1.5, why: "posts you wrote scored 3.0 on stakes, posts you skipped 0.0" }]);
    expect(readChoices(dir).weights.stakes).toBe(1); // not applied on its own
    expect(applyWeights(dir, suggested).weights.stakes).toBe(1.5);
    expect(JSON.parse(readFileSync(join(dir, CHOICES_FILE), "utf8")).weights.carryOver).toBe(1);
  });
});
