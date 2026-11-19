import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateOf } from "../src/ranking/candidates.js";
import { isRankingView, RANKING_FILE, rankNow } from "../src/ranking/run.js";
import { parseAnswer, SCORER_PERSONA, SCORER_VERSION, scoreAll, scoredFrom, scorerPrompt, SCORES_FILE } from "../src/ranking/scorer.js";
import { parseSettings } from "../src/settings.js";
import type { TopicDocument } from "../src/sources/types.js";
import type { TurnAsker } from "../src/turns/queue.js";
import type { Ran } from "../src/turns/ran.js";
import { tempDir } from "./helpers.js";

const doc = (id: string, lines: string[], kind: TopicDocument["kind"] = "decision"): TopicDocument =>
  ({ id, kind, source: "s", title: lines[0]!.replace(/^# /u, ""), lines, location: { path: `/o/${id}.md`, line: 1 } });
const ADR = doc("adr", ["# ADR 0028: fast and slow tests", "CI is the main delivery bottleneck across every repo.", "Slow tests run every three hours."]);
const OTHER = doc("other", ["# Other", "CI is the main delivery bottleneck again here."]);
const answer = (over: Record<string, unknown> = {}) => JSON.stringify({ topic: "Why slow tests moved out of the way", takeaway: "Split tests by speed",
  stakes: { score: 3, quote: "CI is the main delivery bottleneck" }, carryOver: { score: 2, quote: "Slow tests run every three hours." },
  thoughtProcess: { score: 1, quote: "made up words that are not there" }, ...over });
const RAN: Ran = { persona: "ghostpen.scorer", instructionsVersion: SCORER_VERSION, provider: "a-provider", model: "a-model", effort: null, thinkingLevel: "a-level" };
/** A fake of the service's turns: each ask is kept and answered, its `ran` naming the version it was sent. */
const turnsOf = () => {
  const asked: Array<{ persona: string; version: string; timeoutMs: number }> = [];
  const turns: TurnAsker = { ask: async (persona, version, _prompt, timeoutMs) => {
    asked.push({ persona, version, timeoutMs });
    return { text: answer(), ran: { ...RAN, instructionsVersion: version } };
  } };
  return { turns, asked };
};
const kept = (dir: string) => JSON.parse(readFileSync(join(dir, SCORES_FILE), "utf8")) as { entries: Record<string, { hash: string; ran?: Ran }> };

describe("the scorer", () => {
  it("is told the rubric for the candidate's kind, the plain-words rule and the numbered document", () => {
    const prompt = scorerPrompt(candidateOf(ADR));
    expect(prompt).toContain("so a 10-year-old could follow it");
    expect(prompt).toContain("- stakes: how hard or costly the choice was");
    expect(prompt).not.toContain("- evidence:");
    expect(prompt).toContain("2: CI is the main delivery bottleneck across every repo.");
    expect(scorerPrompt(candidateOf(doc("e", ["# trial", "fell 28%"], "experiment")))).toContain("- evidence: measured results");
  });

  it("takes the JSON object out of the answer and checks every quote against the document", () => {
    expect(parseAnswer("```json\n{\"a\": 1}\n```")).toEqual({ a: 1 });
    expect(() => parseAnswer("no json here")).toThrow("no JSON object");
    const scored = scoredFrom(candidateOf(ADR), parseAnswer(answer()));
    expect(scored.topic).toBe("Why slow tests moved out of the way");
    expect(scored.scores.map((s) => [s.factor, s.score, s.line])).toEqual([["stakes", 3, 2], ["carryOver", 2, 3], ["thoughtProcess", 0, null]]);
    expect(scoredFrom(candidateOf(ADR), { topic: "a\nsecond line" }).topic).toBe("a");
  });

  it("scores only documents that changed, and leaves out a candidate it fails on rather than inventing scores", async () => {
    const dir = tempDir();
    const settings = { timeoutSeconds: 10 };
    let asked = 0;
    const run = async () => { asked += 1; return answer(); };
    const other = candidateOf(OTHER);
    await scoreAll([candidateOf(ADR), other], settings, dir, { run });
    expect(asked).toBe(2);
    await scoreAll([candidateOf(ADR), other], settings, dir, { run });
    expect(asked).toBe(2); // nothing changed: nothing asked
    const edited = candidateOf(doc("adr", [...ADR.lines, "A new line."]));
    const result = await scoreAll([edited, other], settings, dir, { run: async () => { throw new Error("rate limited"); } });
    expect([...result.scored.keys()]).toEqual(["other"]);
    expect(result.failures).toEqual([{ candidate: "adr", problem: "rate limited" }]);
    expect(Object.keys(kept(dir).entries)).toEqual(["adr", "other"]); // the old score is kept, not replaced
  });
});

describe("the scorer's model turns (ghostpen#146)", () => {
  it("asks a ghostpen.scorer turn under SCORER_VERSION, at most chatter's 30 minutes, and keeps what it ran on with the score", async () => {
    const dir = tempDir(), { turns, asked } = turnsOf();
    const result = await scoreAll([candidateOf(ADR)], { timeoutSeconds: 3600 }, dir, { turns });
    expect(SCORER_PERSONA).toBe("ghostpen.scorer");
    expect(asked).toEqual([{ persona: "ghostpen.scorer", version: SCORER_VERSION, timeoutMs: 30 * 60_000 }]);
    expect(result.scored.get("adr")?.topic).toBe("Why slow tests moved out of the way");
    expect(kept(dir).entries.adr?.ran).toEqual(RAN);
  });

  it("leaves out a candidate whose turn fails, with its failure, never made-up scores", async () => {
    const dir = tempDir();
    const turns: TurnAsker = { ask: async (_persona, _version, prompt) => {
      if (prompt.includes("Document: Other")) throw new Error("nobody took ghostpen's ghostpen.scorer turn within 300 s");
      return { text: answer(), ran: RAN };
    } };
    const result = await scoreAll([candidateOf(ADR), candidateOf(OTHER)], { timeoutSeconds: 300 }, dir, { turns });
    expect([...result.scored.keys()]).toEqual(["adr"]);
    expect(result.failures).toEqual([{ candidate: "other", problem: "nobody took ghostpen's ghostpen.scorer turn within 300 s" }]);
    expect(Object.keys(kept(dir).entries)).toEqual(["adr"]);
  });

  it("keeps kept scores and their ran across a version bump, and reads a score kept before with no ran as valid", async () => {
    const dir = tempDir(), candidates = [candidateOf(ADR), candidateOf(OTHER)];
    await scoreAll(candidates, { timeoutSeconds: 300 }, dir, { turns: turnsOf().turns });
    // As if ADR was scored under an older version, and OTHER before ghostpen#146 (no ran).
    const file = kept(dir);
    file.entries.adr!.ran = { ...RAN, instructionsVersion: "0" };
    delete file.entries.other!.ran;
    writeFileSync(join(dir, SCORES_FILE), JSON.stringify({ version: 1, ...file }));
    const again = turnsOf();
    const result = await scoreAll(candidates, { timeoutSeconds: 300 }, dir, { turns: again.turns });
    expect(again.asked).toEqual([]); // nothing rescored
    expect([...result.scored.keys()]).toEqual(["adr", "other"]);
    expect(kept(dir).entries.adr?.ran).toEqual({ ...RAN, instructionsVersion: "0" });
    expect(kept(dir).entries.other).not.toHaveProperty("ran");
  });

  it("refuses to score with nothing to ask: rankings run in the service", async () => {
    await expect(scoreAll([candidateOf(ADR)], { timeoutSeconds: 300 }, tempDir()))
      .rejects.toThrow("rankings run in ghostpen's service, which asks chatter's adapter for the scorer's model turns");
  });
});

describe("a ranking run", () => {
  it("reads the sources, ranks the scored candidates, keeps every problem, and writes the result for the app", async () => {
    const root = tempDir(), data = tempDir();
    mkdirSync(join(root, "chatter", "decisions"), { recursive: true });
    // CI named three times: central, so it is a cost (one passing mention would not be, ghostpen#111).
    writeFileSync(join(root, "chatter", "decisions", "0028.md"), [...ADR.lines, "CI runs on the check runner.", "Every change waits for CI."].join("\n"));
    mkdirSync(join(root, "chatter", "docs"), { recursive: true });
    writeFileSync(join(root, "chatter", "docs", "CONTEXT.md"), "# g\n\n## CI\nThe checks that run on every change.\n");
    const settings = parseSettings({ instance: "host", port: 8794, dataDir: data, scorer: {},
      sources: { topics: [{ name: "decisions", kind: "markdown", root, include: ["*/decisions/*.md", "none/*.md"] }],
        references: [{ name: "glossaries", kind: "glossary", root, include: ["*/docs/CONTEXT.md"] }] } });
    const view = await rankNow(settings, { run: async () => answer(), now: new Date("2026-10-25T00:00:00Z") });
    expect(view.entries.map((e) => [e.id, e.total, e.explain, e.topic])).toEqual([["decisions:chatter/decisions/0028.md", 5, ["ci"], "Why slow tests moved out of the way"]]);
    expect(view.entries[0]!.scores[0]!.location).toBe(`${join(root, "chatter", "decisions", "0028.md")}:2`);
    expect(view.background).toEqual([{ part: "ci", unlocks: ["decisions:chatter/decisions/0028.md"],
      mentions: [{ id: "decisions:chatter/decisions/0028.md", line: 2, quote: "CI is the main delivery bottleneck across every repo.", location: `${join(root, "chatter", "decisions", "0028.md")}:2` }],
      defined: [{ where: `${join(root, "chatter", "docs", "CONTEXT.md")}:3`, text: "The checks that run on every change." }] }]);
    expect(view.problems).toEqual(["decisions: its pattern none/*.md matches no file"]);
    expect(JSON.parse(readFileSync(join(data, RANKING_FILE), "utf8")).ranAt).toBe("2026-10-25T00:00:00.000Z");
    expect(isRankingView(JSON.parse(readFileSync(join(data, RANKING_FILE), "utf8")))).toBe(true); // what a run writes, the page reads
    // A ranking written before references existed still reads, with empty references, until the next run.
    const older: any = { ...view, background: [{ part: "ci", unlocks: ["decisions:chatter/decisions/0028.md"] }] };
    expect(isRankingView(older)).toBe(true);
    expect(older.background[0]).toEqual({ part: "ci", unlocks: ["decisions:chatter/decisions/0028.md"], mentions: [], defined: [] });
    expect(isRankingView({ ...view, background: [{ part: "ci", unlocks: [], mentions: [{ id: "x" }], defined: [] }] })).toBe(false);
    const unset = await rankNow({ ...settings, scorer: undefined }, { now: new Date() });
    expect(unset.entries).toEqual([]);
    expect(unset.problems).toContain("no scorer is set (settings.scorer): nothing is ranked");
  });

  it("asks the scorer on the turns it is handed, and fails whole with none (the service hands its own)", async () => {
    const root = tempDir(), data = tempDir();
    mkdirSync(join(root, "decisions"), { recursive: true });
    writeFileSync(join(root, "decisions", "0028.md"), ADR.lines.join("\n"));
    const settings = parseSettings({ instance: "host", port: 8794, dataDir: data, scorer: { command: ["left-from-older-settings"] },
      sources: { topics: [{ name: "decisions", kind: "markdown", root, include: ["decisions/*.md"] }] } });
    await expect(rankNow(settings)).rejects.toThrow("rankings run in ghostpen's service");
    const { turns, asked } = turnsOf();
    const view = await rankNow(settings, { turns });
    expect(asked.map((a) => a.persona)).toEqual(["ghostpen.scorer"]);
    expect(view.entries.map((e) => e.topic)).toEqual(["Why slow tests moved out of the way"]);
    expect(Object.values(kept(data).entries).map((e) => e.ran)).toEqual([RAN]);
  });
});
