import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWritten, revisePrompt, writerPrompt, type WriterBrief } from "../src/draft/prompt.js";
import { parseStackMap, readStackMap, STACK_MAP_FORMAT } from "../src/draft/stack-map.js";
import { draftFile, draftNow, readDraft } from "../src/draft/write.js";
import { parseSettings, type GhostpenSettings } from "../src/settings.js";
import { tempDir, tree } from "./helpers.js";

const MAP = JSON.stringify({ format: STACK_MAP_FORMAT, scope: "x", source: "y",
  nodes: [{ id: "chatter", kind: "app", label: "chatter" }, { id: "clock", kind: "adapter", label: "Clock" }, { id: "tempo", kind: "adapter", label: "Tempo" }],
  edges: [{ from: "chatter", to: "clock", kind: "adapter" }, { from: "chatter", to: "tempo", kind: "adapter" }] });
const answer = (markdown: string, title = "How we time things") => JSON.stringify({ title, summary: "A short note.", tags: ["ops", "Bad Tag"], markdown });
const PLAIN = "We had a choice to make. We picked the small way. It worked well for us.";

/** Sources: one ADR naming Clock and Tempo, a glossary for both, a blog with a post about Tempo. */
function setup(over: Record<string, unknown> = {}): GhostpenSettings {
  const root = tree({
    "p/decisions/adr/0001-timers.md": "# ADR 0001: Use one timer app\n\n## Decision\n1. **Clock runs every timer.**\nTempo grades the work.\n",
    "p/docs/CONTEXT.md": "# glossary\n\n## Clock\nA small app that runs timers.\n\n## Tempo\nAn app that grades how work went.\n\n## Unused\nNever named.\n",
    "blog/tempo.mdx": "---\ntitle: 'What Tempo is'\ndate: '2026-01-01'\ntags: ['tempo']\nsummary: 'About Tempo.'\n---\nI wrote this myself.\n",
    "blog/robot.mdx": "---\ntitle: 'A robot post'\ndate: '2026-02-01'\naiGenerated: true\n---\nWritten by a model.\n",
    "blog/unready.mdx": "---\ntitle: 'Not out yet'\ndate: '2026-03-01'\ndraft: true\n---\nAn unpublished draft.\n",
    "style.md": "Write like a friend.\n" });
  return parseSettings({ instance: "i", port: 8794, dataDir: tempDir(), sources: {
    topics: [{ name: "decisions", kind: "markdown", root: join(root, "p"), include: ["decisions/**/*.md"] }],
    references: [{ name: "g", kind: "glossary", root: join(root, "p"), include: ["docs/CONTEXT.md"] }],
    published: { blogDir: join(root, "blog"), baseUrl: "https://blog.example" } },
  draft: { writer: { command: ["true"] }, styleGuide: join(root, "style.md"), stackMap: { command: ["true"] } }, ...over });
}
const ID = "decisions:decisions/adr/0001-timers.md";
const LINKED = `${PLAIN} [Tempo](https://blog.example/blog/tempo) grades work. We use Clock, a timer app.`;

describe("settings.draft", () => {
  it("reads the writer with its defaults and checks every field", () => {
    const base = { instance: "i", port: 8794, dataDir: "/d" };
    expect(parseSettings({ ...base, draft: { writer: { command: ["w"] } } }).draft).toEqual({ writer: { command: ["w"], timeoutSeconds: 900 }, voicePosts: 2, revisions: 2 });
    expect(parseSettings({ ...base, draft: { writer: { command: ["w"] }, stackMap: { command: ["relay", "graph"] } } }).draft?.stackMap).toEqual({ command: ["relay", "graph"], timeoutSeconds: 60 });
    for (const [draft, error] of [[{}, "draft.writer must be an object"], [{ writer: { command: [] } }, "draft.writer.command must be a non-empty list"],
      [{ writer: { command: ["w"] }, revisions: 4 }, "draft.revisions must be 0 to 3"], [{ writer: { command: ["w"] }, voicePosts: -1 }, "draft.voicePosts must be 0 to 5"],
      [{ writer: { command: ["w"] }, styleGuide: "rel.md" }, "draft.styleGuide must be an absolute path"],
      [{ writer: { command: ["w"] }, stackMap: { command: ["x"], timeoutSeconds: 5 } }, "draft.stackMap.timeoutSeconds must be 10 to 3600"]] as const) {
      expect(() => parseSettings({ ...base, draft })).toThrow(error);
    }
  });
});

describe("the stack map", () => {
  it("reads relay's map and refuses anything else", () => {
    expect(parseStackMap(MAP).edges).toEqual([{ from: "chatter", to: "clock" }, { from: "chatter", to: "tempo" }]);
    expect(() => parseStackMap("nope")).toThrow("not JSON");
    expect(() => parseStackMap(JSON.stringify({ format: "other", nodes: [], edges: [] }))).toThrow(`not ${STACK_MAP_FORMAT}`);
    expect(() => parseStackMap(JSON.stringify({ format: STACK_MAP_FORMAT, nodes: [{ id: "a" }], edges: [] }))).toThrow("right shape");
    expect(() => parseStackMap(JSON.stringify({ format: STACK_MAP_FORMAT, nodes: [], edges: [{ from: "a" }] }))).toThrow("right shape");
  });

  it("gives no map, with the reason, when unset or unreadable", async () => {
    expect(await readStackMap(undefined)).toEqual({ graph: null, problem: "no stack map is configured (settings.draft.stackMap)" });
    expect(await readStackMap({ command: ["x"], timeoutSeconds: 60 }, async () => { throw new Error("relay is not installed"); }))
      .toEqual({ graph: null, problem: "relay is not installed" });
    expect((await readStackMap({ command: ["x"], timeoutSeconds: 60 }, async () => MAP)).graph?.nodes).toHaveLength(3);
  });

  it("runs the configured command", async () => {
    const result = await readStackMap({ command: ["node", "-e", `process.stdout.write(${JSON.stringify(MAP)})`], timeoutSeconds: 10 });
    expect(result.graph?.nodes.map((n) => n.label)).toEqual(["chatter", "Clock", "Tempo"]);
  });
});

describe("the writer's prompt and answer", () => {
  const brief: WriterBrief = { kind: "decision", subject: "ADR 0001", topic: "one timer app", takeaway: "fewer timers, fewer bugs",
    documents: [{ id: "d", kind: "decision", source: "s", title: "ADR 0001", lines: ["Clock runs every timer."], location: {} }],
    parts: [{ term: "Tempo", post: { url: "https://blog.example/blog/tempo", title: "T" } }, { term: "Clock", definition: "A small app\nthat runs timers." }],
    graph: { nodes: [{ id: "chatter", label: "chatter" }, { id: "clock", label: "Clock" }], edges: [{ from: "chatter", to: "clock" }] },
    styleGuide: "Be warm.", voice: [{ title: "Old post", body: "Hello there." }] };

  it("puts the 10-year-old rule first and gives every part, arrow, voice and source", () => {
    const prompt = writerPrompt(brief);
    expect(prompt.indexOf("THE FIRST RULE: a 10-year-old")).toBeLessThan(prompt.indexOf("style guide"));
    expect(prompt).toContain("It is about: one timer app.");
    expect(prompt).toContain("A reader should leave with: fewer timers, fewer bugs");
    expect(prompt).toContain("Link it where it first appears: [Tempo](https://blog.example/blog/tempo)");
    expect(prompt).toContain("Its definition: A small app that runs timers.");
    expect(prompt).toContain("- chatter --> Clock");
    expect(prompt).toContain("Be warm.");
    expect(prompt).toContain("for the voice only (not for facts): Old post\nHello there.");
    expect(prompt).toContain("### ADR 0001\nClock runs every timer.");
    expect(prompt).toContain("If the outcome is not known yet, say so plainly");
  });

  it("forbids setup diagrams with no map", () => {
    expect(writerPrompt({ ...brief, graph: null })).toContain("Draw no diagram of the setup");
    expect(writerPrompt({ ...brief, graph: { nodes: [{ id: "clock", label: "Clock" }], edges: [] } })).toContain("Draw no diagram of the setup");
  });

  it("sends a failed draft back with only the failed checks", () => {
    const report = { passed: false, grade: 3, hold: [], later: [], checks: [{ name: "Plain words", passed: true, findings: [] },
      { name: "Every stack part linked or explained", passed: false, findings: ["Tempo has a post: link it"] }] };
    const prompt = revisePrompt(brief, { title: "T", summary: "S", tags: [], markdown: "Body" }, report);
    expect(prompt).toContain("Every stack part linked or explained:\n- Tempo has a post: link it");
    expect(prompt).not.toContain("Plain words:");
    expect(prompt).toContain('"markdown":"Body"');
  });

  it("reads the answer from a code fence, keeps good tags and refuses a broken one", () => {
    expect(parseWritten("```json\n" + answer("Body") + "\n```")).toEqual({ title: "How we time things", summary: "A short note.", tags: ["ops"], markdown: "Body" });
    expect(() => parseWritten("no json")).toThrow("no JSON object");
    expect(() => parseWritten("{bad}")).toThrow("not valid JSON");
    expect(() => parseWritten(JSON.stringify({ title: "T", summary: "S" }))).toThrow("has no markdown");
    expect(() => parseWritten(JSON.stringify({ title: " ", summary: "S", markdown: "M" }))).toThrow("has no title");
  });
});

describe("drafting a post", () => {
  it("drafts, checks and keeps a passing draft", async () => {
    const settings = setup();
    const prompts: string[] = [];
    const draft = await draftNow(settings, ID, { write: async (p) => { prompts.push(p); return answer(LINKED); }, stackMap: async () => MAP, now: new Date("2026-10-25T00:00:00Z") });
    expect(draft).toMatchObject({ id: ID, kind: "decision", status: "ready", attempts: 1, title: "How we time things", madeAt: "2026-10-25T00:00:00.000Z", problems: [] });
    expect(draft.report.later).toEqual(["Clock"]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Link it where it first appears: [Tempo](https://blog.example/blog/tempo)");
    expect(prompts[0]).toContain("Its definition: A small app that runs timers.");
    expect(prompts[0]).not.toContain("Unused");
    expect(prompts[0]).toContain("Write like a friend.");
    expect(prompts[0]).toContain("I wrote this myself.");
    expect(prompts[0]).not.toContain("Written by a model.");
    expect(prompts[0]).not.toContain("An unpublished draft.");
    expect(prompts[0]).toContain("- chatter --> Clock");
    expect(readDraft(settings.dataDir, ID)).toEqual(draft);
  });

  it("sends a failing draft back until it passes", async () => {
    const replies = [answer(`${PLAIN} We use Clock.`), answer(LINKED)];
    const prompts: string[] = [];
    const draft = await draftNow(setup(), ID, { write: async (p) => { prompts.push(p); return replies.shift()!; }, stackMap: async () => MAP });
    expect(draft).toMatchObject({ status: "ready", attempts: 2 });
    expect(prompts[1]).toContain("Your last draft failed these checks");
  });

  it("stops after the set number of revisions and keeps the failed draft", async () => {
    let calls = 0;
    const draft = await draftNow(setup({ draft: { writer: { command: ["true"] }, revisions: 1 } }), ID, { write: async () => { calls += 1; return answer(`${PLAIN} We use Clock.`); } });
    expect(calls).toBe(2);
    expect(draft).toMatchObject({ status: "failed", attempts: 2 });
    expect(draft.problems).toContain("stack map: no stack map is configured (settings.draft.stackMap)");
  });

  it("stops at once when a central part has no post: rewording cannot fix that", async () => {
    let calls = 0;
    const draft = await draftNow(setup(), ID, { write: async () => { calls += 1; return answer(LINKED, "Why Clock runs every timer"); }, stackMap: async () => MAP });
    expect(calls).toBe(1);
    expect(draft).toMatchObject({ status: "held", attempts: 1 });
    expect(draft.report.hold).toEqual(["Clock"]);
  });

  it("keeps the last draft when a revision fails", async () => {
    const replies = [answer(`${PLAIN} We use Clock.`)];
    const draft = await draftNow(setup(), ID, { write: async () => { const r = replies.shift(); if (!r) throw new Error("the draft writer exited 1"); return r; }, stackMap: async () => MAP });
    expect(draft).toMatchObject({ status: "failed", attempts: 1 });
    expect(draft.problems).toContain("revision 1: the draft writer exited 1");
  });

  it("drafts a background post about a part, which may name it as often as it likes", async () => {
    const prompts: string[] = [];
    const markdown = `${PLAIN} Clock is a timer app. Clock runs. Clock stops. [Tempo](https://blog.example/blog/tempo) grades work.`;
    const draft = await draftNow(setup(), "background:clock", { write: async (p) => { prompts.push(p); return answer(markdown, "What Clock is"); }, stackMap: async () => MAP });
    expect(draft).toMatchObject({ kind: "background", status: "ready" });
    expect(prompts[0]).toContain("a background post");
    expect(prompts[0]).toContain("### ADR 0001: Use one timer app");
    expect(prompts[0]).not.toContain("- Clock: no post explains it");
  });

  it("refuses unknown ids and missing settings, drafting nothing", async () => {
    const settings = setup();
    await expect(draftNow(settings, "decisions:nope.md", { write: async () => answer(LINKED) })).rejects.toThrow("no source document has the id decisions:nope.md");
    await expect(draftNow(settings, "background:Nothing", { write: async () => answer(LINKED) })).rejects.toThrow("nothing in the sources defines or names Nothing");
    await expect(draftNow({ ...settings, draft: undefined }, ID)).rejects.toThrow("no draft writer is set");
    expect(existsSync(draftFile(settings.dataDir, ID))).toBe(false);
  });

  it("uses the ranking's topic and takeaway when the candidate is ranked", async () => {
    const settings = setup();
    writeFileSync(join(settings.dataDir, "ranking.json"), JSON.stringify({ ranAt: "x", problems: [], background: [], owed: [],
      entries: [{ id: ID, kind: "decision", title: "t", topic: "picking one timer", takeaway: "simple wins", total: 3, explain: [], location: "l", scores: [] }] }));
    const prompts: string[] = [];
    await draftNow(settings, ID, { write: async (p) => { prompts.push(p); return answer(LINKED); } });
    expect(prompts[0]).toContain("It is about: picking one timer.");
    expect(prompts[0]).toContain("A reader should leave with: simple wins");
  });

  it("takes screenshots once the words pass, and fails the draft on a private one", async () => {
    const shots = { pages: [{ name: "console", url: "http://127.0.0.1:1/", description: "the console", mask: [], width: 1280, height: 800 }], private: [], timeoutSeconds: 30 };
    const settings = setup({ draft: { writer: { command: ["true"] }, screenshots: shots } });
    const markdown = `${LINKED}\n\n![the console with three tasks](screenshot:console)`;
    const prompts: string[] = [];
    const ok = await draftNow(settings, ID, { write: async (p) => { prompts.push(p); return answer(markdown); }, capture: async () => ({ png: Buffer.from("P"), text: ["3 tasks"], unreadable: [] }) });
    expect(prompts[0]).toContain("- console: the console");
    expect(ok.status).toBe("ready");
    expect(Object.keys(ok.screenshots)).toEqual(["console"]);
    expect(ok.report.checks.at(-1)).toEqual({ name: "Screenshots show nothing private", passed: true, findings: [] });
    const bad = await draftNow(settings, ID, { write: async () => answer(markdown), capture: async () => ({ png: Buffer.from("P"), text: ["tim@example.com"], unreadable: [] }) });
    expect(bad).toMatchObject({ status: "failed", screenshots: {} });
    expect(bad.report.passed).toBe(false);
  });

  it("takes no screenshots for a draft whose words fail", async () => {
    let captured = 0;
    const shots = { pages: [{ name: "console", url: "http://127.0.0.1:1/", description: "the console" }] };
    const draft = await draftNow(setup({ draft: { writer: { command: ["true"] }, revisions: 0, screenshots: shots } }), ID,
      { write: async () => answer(`${PLAIN} We use Clock.\n\n![x](screenshot:console)`), capture: async () => { captured += 1; return { png: Buffer.from(""), text: [], unreadable: [] }; } });
    expect(draft.status).toBe("failed");
    expect(captured).toBe(0);
  });

  it("keeps drafts under distinct files per id", () => {
    expect(draftFile("/d", "a/b")).not.toBe(draftFile("/d", "a-b"));
    expect(draftFile("/d", "background:clock")).toMatch(/^\/d\/drafts\/background-clock-[0-9a-f]{8}\.json$/u);
  });
});
