import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateOf } from "../src/ranking/candidates.js";
import { isRankingView, RANKING_FILE, rankNow } from "../src/ranking/run.js";
import { KILL_GRACE_MS, parseAnswer, runScorer, scoreAll, scoredFrom, scorerPrompt, SCORES_FILE } from "../src/ranking/scorer.js";
import { parseSettings } from "../src/settings.js";
import type { TopicDocument } from "../src/sources/types.js";
import { tempDir } from "./helpers.js";

const doc = (id: string, lines: string[], kind: TopicDocument["kind"] = "decision"): TopicDocument =>
  ({ id, kind, source: "s", title: lines[0]!.replace(/^# /u, ""), lines, location: { path: `/o/${id}.md`, line: 1 } });
const ADR = doc("adr", ["# ADR 0028: fast and slow tests", "CI is the main delivery bottleneck across every repo.", "Slow tests run every three hours."]);
const answer = (over: Record<string, unknown> = {}) => JSON.stringify({ topic: "Why slow tests moved out of the way", takeaway: "Split tests by speed",
  stakes: { score: 3, quote: "CI is the main delivery bottleneck" }, carryOver: { score: 2, quote: "Slow tests run every three hours." },
  thoughtProcess: { score: 1, quote: "made up words that are not there" }, ...over });

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

  it("runs the configured command with the prompt on stdin, and says why when it fails", async () => {
    const echo = { command: ["node", "-e", "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({len:s.length})))"], timeoutSeconds: 10 };
    expect(JSON.parse(await runScorer(echo, "hello"))).toEqual({ len: 5 });
    await expect(runScorer({ command: ["node", "-e", "console.error('quota gone');process.exit(3)"], timeoutSeconds: 10 }, "x"))
      .rejects.toThrow("the scorer exited 3: quota gone");
    await expect(runScorer({ command: ["node", "-e", "setTimeout(()=>{}, 5000)"], timeoutSeconds: 1 }, "x")).rejects.toThrow("did not answer within 1 s");
    await expect(runScorer({ command: ["/nonexistent/scorer"], timeoutSeconds: 10 }, "x")).rejects.toThrow("could not start");
  });

  it("stops a timed-out scorer that ignores SIGTERM, and the child it started, so nothing keeps running", async () => {
    const dir = tempDir(), pids = join(dir, "pids");
    // The scorer ignores SIGTERM and starts a child that ignores it too; both write their pid.
    const script = `const fs=require('fs');process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},process.pid+' '+c.pid);setInterval(()=>{},1000)`;
    const started = Date.now();
    await expect(runScorer({ command: ["node", "-e", script], timeoutSeconds: 1 }, "x")).rejects.toThrow("did not answer within 1 s");
    expect(Date.now() - started).toBeLessThan(5_000);
    await new Promise((done) => setTimeout(done, KILL_GRACE_MS + 1_000));
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const pid of readFileSync(pids, "utf8").split(" ").map(Number)) expect(alive(pid)).toBe(false);
  }, 15_000);

  it("still kills a child that ignores SIGTERM after the scorer itself exited on it", async () => {
    const dir = tempDir(), pids = join(dir, "pids");
    // The scorer dies on SIGTERM (the default); the child it started ignores it.
    const script = `const fs=require('fs');const c=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},String(c.pid));setInterval(()=>{},1000)`;
    await expect(runScorer({ command: ["node", "-e", script], timeoutSeconds: 1 }, "x")).rejects.toThrow("did not answer within 1 s");
    await new Promise((done) => setTimeout(done, KILL_GRACE_MS + 1_000));
    const child = Number(readFileSync(pids, "utf8"));
    expect((() => { try { process.kill(child, 0); return true; } catch { return false; } })()).toBe(false);
  }, 15_000);

  it("scores only documents that changed, and leaves out a candidate it fails on rather than inventing scores", async () => {
    const dir = tempDir();
    const settings = { command: ["unused"], timeoutSeconds: 10 };
    let asked = 0;
    const run = async () => { asked += 1; return answer(); };
    const other = candidateOf(doc("other", ["# Other", "CI is the main delivery bottleneck again here."]));
    await scoreAll([candidateOf(ADR), other], settings, dir, run);
    expect(asked).toBe(2);
    await scoreAll([candidateOf(ADR), other], settings, dir, run);
    expect(asked).toBe(2); // nothing changed: nothing asked
    const edited = candidateOf(doc("adr", [...ADR.lines, "A new line."]));
    const result = await scoreAll([edited, other], settings, dir, async () => { throw new Error("rate limited"); });
    expect([...result.scored.keys()]).toEqual(["other"]);
    expect(result.failures).toEqual([{ candidate: "adr", problem: "rate limited" }]);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, SCORES_FILE), "utf8")).entries)).toEqual(["adr", "other"]); // the old score is kept, not replaced
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
    const settings = parseSettings({ instance: "host", port: 8794, dataDir: data, scorer: { command: ["unused"] },
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

  it("refuses a scorer setting it cannot run, naming the field", () => {
    const base = { instance: "x", port: 8794, dataDir: "/d" };
    expect(() => parseSettings({ ...base, scorer: { command: [] } })).toThrow("settings: scorer.command must be a non-empty list of strings");
    expect(() => parseSettings({ ...base, scorer: { command: ["c"], timeoutSeconds: 5 } })).toThrow("settings: scorer.timeoutSeconds must be 10 to 3600");
    expect(parseSettings({ ...base, scorer: { command: ["claude", "-p"] } }).scorer).toEqual({ command: ["claude", "-p"], timeoutSeconds: 300 });
  });
});
