/**
 * The scorer (ADR 0101, brief D2, D5, D6): whatever proposes a candidate's scores, run as the command the settings name
 * (`scorer.command`, an argv run without a shell). Which model and account it uses is the operator's choice, in their
 * settings; nothing here names one. It gets one prompt on stdin, the rubric and the document with numbered lines, and
 * answers one JSON object. Its scores are only proposals: `checkScores` keeps a score only when its quote is in the
 * document word for word. Results are kept by document hash, so a weekly run scores only documents that changed.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "./candidates.js";
import { checkScores, FACTORS, type ProposedScore, type Score } from "./scores.js";

export interface ScorerSettings { command: string[]; timeoutSeconds: number }
/** What a scorer says about a candidate, after its scores are checked. */
export interface Scored { topic: string; takeaway: string; scores: Score[] }
export const SCORES_FILE = "scores.json";
const MAX_PROMPT_LINES = 600;

const MEANING: Record<string, string> = {
  stakes: "how hard or costly the choice was: real options, hard to undo, wide effect",
  carryOver: "whether the reasoning helps people outside this setup, even if the example is specific to it",
  thoughtProcess: "real options weighed, with real reasons why the winner won",
  evidence: "measured results: numbers, before and after, a test or a backtest",
  surprise: "the outcome differed from what was expected, or a decision was reversed",
  completeness: "problem, options, decision and outcome are all known",
};

/** The prompt: the rubric for the candidate's kind, the plain-words rule, the answer's shape, and the numbered document. */
export function scorerPrompt(candidate: Candidate): string {
  const factors = FACTORS[candidate.kind];
  const lines = candidate.document.lines.slice(0, MAX_PROMPT_LINES).map((line, i) => `${i + 1}: ${line}`).join("\n");
  return [`You score one possible blog post (a ${candidate.kind === "decision" ? "decision post" : "post-mortem"}) for how much value it gives a reader.`,
    "Write everything so a 10-year-old could follow it: short sentences, no unexplained words.",
    "Score each factor 0 to 3. For each score above 0, quote the exact words from ONE line of the document that earn it, copied",
    "character for character (at least 8 characters). A quote not found in the document makes that score 0.",
    "", "Factors:", ...factors.map((f) => `- ${f}: ${MEANING[f]}`), "",
    "Answer with one JSON object and nothing else:",
    `{"topic": "<what the post would be about, one plain line>", "takeaway": "<what a reader leaves with, one plain line>", ${factors.map((f) => `"${f}": {"score": 0, "quote": ""}`).join(", ")}}`,
    "", `Document: ${candidate.title}`, lines].join("\n");
}

/** The first JSON object in the scorer's answer (a model may wrap it in a code fence). */
export function parseAnswer(text: string): Record<string, unknown> {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the scorer answered no JSON object");
  const value = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("the scorer answered something other than an object");
  return value as Record<string, unknown>;
}

/** How long a timed-out scorer gets after SIGTERM before its whole process group is killed. */
export const KILL_GRACE_MS = 2_000;

/**
 * Runs the scorer (or another command, named `name` in errors, such as the draft writer) once on `prompt`; resolves its
 * stdout, rejects on a failure, a timeout or a non-zero exit. It runs in a process group of its own, so a timeout stops
 * it and anything it started: SIGTERM to the group, then SIGKILL after `KILL_GRACE_MS` for whatever ignores it. Its
 * streams are closed, so nothing it left keeps ghostpen waiting.
 */
export function runScorer(settings: ScorerSettings, prompt: string, name = "scorer"): Promise<string> {
  return new Promise((resolve, reject) => {
    const [command, ...args] = settings.command;
    const child = spawn(command!, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
    let out = "", err = "", settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const group = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already gone */ } };
    const timer = setTimeout(() => {
      group("SIGTERM");
      // Kept even once the scorer itself exits: a child it started may still ignore SIGTERM. A group already gone is a no-op.
      setTimeout(() => group("SIGKILL"), KILL_GRACE_MS).unref();
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
      settle(() => reject(new Error(`the ${name} did not answer within ${settings.timeoutSeconds} s`)));
    }, settings.timeoutSeconds * 1000);
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.stdin.on("error", () => { /* a scorer that exits without reading its prompt */ });
    child.on("error", (error) => settle(() => reject(new Error(`the ${name} could not start (${error.message})`))));
    child.on("close", (code) => settle(() => {
      if (code === 0) resolve(out);
      else reject(new Error(`the ${name} exited ${String(code)}${err.trim() ? `: ${err.trim().split("\n").pop()!.slice(0, 200)}` : ""}`));
    }));
    child.stdin.end(prompt);
  });
}

const line = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim().split("\n")[0]!.slice(0, 200) : fallback);

/** The scorer's answer for a candidate, its scores checked against the document. */
export function scoredFrom(candidate: Candidate, answer: Record<string, unknown>): Scored {
  const proposed = Object.fromEntries(FACTORS[candidate.kind].map((f) => [f, answer[f] as ProposedScore | undefined]));
  return { topic: line(answer.topic, candidate.title), takeaway: line(answer.takeaway, ""), scores: checkScores(candidate, proposed) };
}

interface Kept { version: 1; entries: Record<string, { hash: string; scored: Scored }> }
const hashOf = (candidate: Candidate) => createHash("sha256").update(`${candidate.kind}\n${candidate.document.lines.join("\n")}`).digest("hex");

/**
 * Scores every candidate whose document changed since it was last scored (or never was); the rest keep their kept scores.
 * A candidate the scorer fails on is left out and its failure returned, never given made-up scores.
 */
export async function scoreAll(candidates: Candidate[], settings: ScorerSettings, dataDir: string,
  run: (prompt: string) => Promise<string> = (prompt) => runScorer(settings, prompt)):
  Promise<{ scored: Map<string, Scored>; failures: Array<{ candidate: string; problem: string }> }> {
  const path = join(dataDir, SCORES_FILE);
  let kept: Kept = { version: 1, entries: {} };
  try { if (existsSync(path)) kept = JSON.parse(readFileSync(path, "utf8")) as Kept; } catch { /* rescored */ }
  if (kept?.version !== 1 || typeof kept.entries !== "object") kept = { version: 1, entries: {} };
  const scored = new Map<string, Scored>();
  const failures: Array<{ candidate: string; problem: string }> = [];
  for (const candidate of candidates) {
    const hash = hashOf(candidate);
    const old = kept.entries[candidate.id];
    if (old && old.hash === hash) { scored.set(candidate.id, old.scored); continue; }
    try {
      const result = scoredFrom(candidate, parseAnswer(await run(scorerPrompt(candidate))));
      kept.entries[candidate.id] = { hash, scored: result };
      scored.set(candidate.id, result);
    } catch (error) {
      failures.push({ candidate: candidate.id, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  writeFileSync(`${path}.tmp`, JSON.stringify(kept, null, 2));
  renameSync(`${path}.tmp`, path);
  return { scored, failures };
}
