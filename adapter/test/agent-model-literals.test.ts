/**
 * ghostpen#146: ghostpen's model turns take their model and thinking level from the persona's route in chatter's settings,
 * never from code (copied from Tempo's test/agent-model-literals.test.ts, itself chatter's src/agent-model-literals.test.ts).
 * In code under `adapter/` and `scripts/` (tests left out), a quoted model name, a field (quoted or not) set to a thinking
 * level, a level a missing setting falls back to (`?? "high"`, `|| "high"`, Python's `or "high"`) or a Python
 * `"<level>" if …` pick counts (the field matched by its name: `effort`, `executionEffort`, `thinking_level`,
 * `thinkingLevel`, `reasoning_effort`); comments and lists of valid levels do not. BASELINE holds the files with a
 * literal that chooses no turn's model, each with why: a file may never gain one, a file not listed may have none, and
 * a file whose count drops lowers its entry in the same change. It starts empty.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
/** The code that could choose a model: the adapter and its service, and the repository's scripts. */
const AGENT_CODE = ["adapter", "scripts"];
const SOURCE = /\.(?:ts|js|mjs|cjs|sh|py)$/u;
const TEST = /(?:^adapter\/test\/|\.test(?:-[a-z-]+)?\.ts$|test-helpers?\.ts$|_test\.py$|fixtures?[^/]*$)/u;
const LEVELS = "minimal|low|medium|high|xhigh|max";
const MODEL = /["'`](?:haiku|sonnet|opus|fable|gpt-\d[\w.-]*|claude-[\w.-]+|gemini-[\w.-]+|o\d(?:-[\w.-]+)?)["'`]/gu;
const LEVEL = new RegExp(String.raw`\b(?:model|\w*(?:effort|Effort|thinking|Thinking|reasoning|Reasoning)\w*)["']?\s*[:=]\s*["'](?:${LEVELS})["']`
  + String.raw`|(?:\?\?|\|\||\bor)\s*["'](?:${LEVELS})["']|["'](?:${LEVELS})["']\s+if\b`, "gu");

/** Each file's allowed count, with why its literals choose no turn's model. Only falls. */
const BASELINE: Readonly<Record<string, { count: number; why: string }>> = {};

/** A line's code without its comment. */
function code(line: string): string {
  const trimmed = line.trimStart();
  if (/^(?:\*|\/\*|\/\/|#)/u.test(trimmed)) return "";
  return line.replace(/\s\/\/\s.*$|\s#\s.*$/u, "");
}

/** The model and thinking-level literals in `text`'s code, as written. */
function literals(text: string): string[] {
  const body = text.split("\n").map(code).join("\n");
  return [...(body.match(MODEL) ?? []), ...(body.match(LEVEL) ?? [])];
}

/** Each file's count against `baseline`, one line per difference; empty when they agree. */
function differences(baseline: Readonly<Record<string, { count: number }>>, counts: ReadonlyMap<string, number>): string[] {
  const found: string[] = [];
  for (const [file, count] of counts) {
    const allowed = baseline[file]?.count;
    if (allowed === undefined) found.push(`${file}: ${count} model or thinking-level literal(s) in code; the persona's route in chatter's settings names them`);
    else if (count > allowed) found.push(`${file}: ${count} model or thinking-level literals, the baseline allows ${allowed}`);
    else if (count < allowed) found.push(`${file}: down to ${count} from ${allowed}: lower its BASELINE entry`);
  }
  for (const file of Object.keys(baseline)) {
    if (!counts.has(file)) found.push(`${file}: no model or thinking-level literal left: delete its BASELINE entry`);
  }
  return found;
}

describe("ghostpen's code names no model or thinking level (its turns read their persona's route, ghostpen#146)", () => {
  it("every source under adapter/ and scripts/ has at most its baseline's count, and the baseline matches", () => {
    // Untracked files too, so a new file is checked before it is committed.
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...AGENT_CODE], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((file) => SOURCE.test(file) && !TEST.test(file));
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("adapter/src/adapter/turns.ts");
    const counts = new Map(files.map((file) => [file, literals(readFileSync(join(ROOT, file), "utf8")).length] as const)
      .filter(([, count]) => count > 0));
    expect(differences(BASELINE, counts)).toEqual([]);
  });

  it("counts a chosen model or level", () => {
    expect(literals(`run({ model: "claude-opus-4" });`)).toEqual([`"claude-opus-4"`]);
    expect(literals(`const m = { model: 'gpt-5', effort: "high" };`)).toEqual([`'gpt-5'`, `effort: "high"`]);
    expect(literals(`const pick = "sonnet";\nconst g = \`gemini-2.5-pro\`;\nconst o = "o3";`)).toHaveLength(3);
    expect(literals(`const d = { thinking_level: "high", "reasoning_effort": "max", 'thinkingLevel': 'low', executionEffort: "medium" };`)).toHaveLength(4);
    expect(literals(`effort: set.effort ?? "high",\nconst e = raw.effort || 'xhigh';\neffort = got or "max"`)).toHaveLength(3);
    expect(literals(`pick = ("medium" if small else "high")`)).toHaveLength(1);
  });

  it("ignores comments, a list of valid levels, a level that is not a setting and a name that only reads one", () => {
    expect(literals(`// model: "claude-opus-4"\n * \`sonnet\` is fast\n# thinking_level = "high"\n/* "gpt-5" */\nconst x = 1; // "sonnet"`)).toEqual([]);
    expect(literals(`const LEVELS = ["low", "medium", "high"];\nconst d = { "effort": level, "label": "high" };`)).toEqual([]);
    expect(literals(`effort: answer.effort ?? null, model: route.model ?? parent.model`)).toEqual([]);
  });

  it("refuses a new file, a gain and a drop left in the baseline, and names a file whose literals are gone", () => {
    const one = (count: number) => ({ count, why: "w" });
    expect(differences({ "adapter/a.ts": one(2), "adapter/gone.ts": one(1) }, new Map([["adapter/a.ts", 3], ["adapter/new.ts", 1]]))).toEqual([
      "adapter/a.ts: 3 model or thinking-level literals, the baseline allows 2",
      "adapter/new.ts: 1 model or thinking-level literal(s) in code; the persona's route in chatter's settings names them",
      "adapter/gone.ts: no model or thinking-level literal left: delete its BASELINE entry"]);
    expect(differences({ "adapter/a.ts": one(2) }, new Map([["adapter/a.ts", 1]]))).toEqual(["adapter/a.ts: down to 1 from 2: lower its BASELINE entry"]);
  });

  it("leaves tests out", () => {
    expect(TEST.test("adapter/test/helpers.ts")).toBe(true);
    expect(TEST.test("adapter/e2e/app.browser.test.ts")).toBe(true);
    expect(TEST.test("adapter/src/adapter/turns.ts")).toBe(false);
  });
});
