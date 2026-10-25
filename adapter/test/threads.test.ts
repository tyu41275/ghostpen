import { writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answerThreadMessage } from "../src/adapter/threads.js";
import adapter from "../src/adapter/index.js";
import { syncShortlist, threadName, type Button } from "../src/adapter/shortlist.js";
import { writerPrompt } from "../src/draft/prompt.js";
import { addFeedback, readFeedback } from "../src/feedback/store.js";
import { answerInThread, parseThreadAnswer, threadPrompt, threadTopic } from "../src/feedback/thread.js";
import { RANKING_FILE } from "../src/ranking/run.js";
import { renderApp } from "../src/service/app.js";
import { createGhostpenServer } from "../src/service/server.js";
import { parseSettings, type GhostpenSettings } from "../src/settings.js";
import { saveShortlists } from "../src/shortlist/state.js";
import { KEY, keyFile, tempDir, tree } from "./helpers.js";

const OPERATOR = "234652039735541760";
const WEEK = "2026-10-26";
const NOW = new Date("2026-10-26T14:00:00Z");
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))); });

/** Settings over one decision document, a ranking entry for it, and a week whose card has a thread. */
function setup(over: Record<string, unknown> = {}): GhostpenSettings {
  const root = tree({ "p/decisions/0001-timers.md": "# ADR 0001: One timer app\n\n## Decision\n1. **Clock runs every timer.**\nIt saved two hours a week.\n" });
  const dataDir = tempDir();
  const settings = parseSettings({ instance: "host", port: 8794, dataDir, adapterKeyFile: keyFile(dataDir), shortlist: { operator: OPERATOR, channel: "1563701613099745320" },
    sources: { topics: [{ name: "decisions", kind: "markdown", root: join(root, "p"), include: ["decisions/*.md"] }] }, ...over });
  const id = "decisions:decisions/0001-timers.md";
  writeFileSync(join(dataDir, RANKING_FILE), JSON.stringify({ ranAt: "x", problems: [], background: [], owed: [], entries: [{ id, kind: "decision", title: "ADR 0001",
    topic: "one timer app", takeaway: "fewer timers, fewer bugs", total: 6, explain: [], location: "l",
    scores: [{ factor: "stakes", score: 3, quote: "Clock runs every timer.", line: 4, location: "l:4" }] }] }));
  saveShortlists(dataDir, { version: 1, weeks: { [WEEK]: { madeAt: "x", items: [
    { id, kind: "decision", text: "**#1 Why one timer app** (Decision post, score 6)\nWhy: …", posted: { channelRef: "c", messageRef: "m1", threadRef: "t1" } },
    { id: "background:clock", kind: "background", text: "**Background post: what Clock is**", posted: { channelRef: "c", messageRef: "m2" },
      draft: { status: "ready", round: 1, title: "What Clock is", at: "x", card: { channelRef: "c", messageRef: "d1", round: 1, status: "ready" } } }] } } });
  return settings;
}
const ID = "decisions:decisions/0001-timers.md";

describe("which card a thread belongs to", () => {
  it("knows the thread ghostpen opened, a thread opened on the card itself, and one on a draft card", () => {
    const { dataDir } = setup();
    expect(threadTopic(dataDir, "t1")).toEqual({ topic: ID, title: "#1 Why one timer app (Decision post, score 6)" });
    expect(threadTopic(dataDir, "m1")?.topic).toBe(ID);
    expect(threadTopic(dataDir, "m2")?.topic).toBe("background:clock");
    expect(threadTopic(dataDir, "d1")).toEqual({ topic: "background:clock", title: "What Clock is" });
    expect(threadTopic(dataDir, "other")).toBeNull();
    expect(threadTopic(dataDir, "")).toBeNull();
  });

  it("names a card's thread after its first line, without markdown, within Discord's limit", () => {
    expect(threadName("**#1 Why one timer app** (Decision post, score 6)\nWhy: …")).toBe("Why one timer app (Decision post, score 6)");
    expect(threadName("**Background post: what Clock is**")).toBe("Background post: what Clock is");
    expect(threadName(`**${"x".repeat(150)}**`)).toHaveLength(100);
    expect(threadName("****")).toBe("This topic");
  });
});

describe("answering in a thread", () => {
  it("asks from the sources, the scores and the thread so far, the plain-words rule first", async () => {
    const settings = setup();
    addFeedback(settings.dataDir, { at: "t0", by: OPERATOR, topic: ID, kind: "context", text: "We tried three timers first." });
    addFeedback(settings.dataDir, { at: "t0", by: OPERATOR, topic: ID, kind: "reason", action: "skip", text: "never shown in the thread" });
    const prompt = await threadPrompt(settings, ID, "Why one timer app", "Why is this ranked first?");
    expect(prompt.indexOf("10-year-old")).toBeLessThan(prompt.indexOf("Proposal:"));
    expect(prompt).toContain("Ranked 6: one timer app. A reader leaves with: fewer timers, fewer bugs");
    expect(prompt).toContain('- stakes 3/3: "Clock runs every timer."');
    expect(prompt).toContain("### ADR 0001: One timer app\n# ADR 0001: One timer app");
    expect(prompt).toContain("author (context): We tried three timers first.");
    expect(prompt).not.toContain("never shown in the thread");
    expect(prompt.endsWith("The author's new message: Why is this ranked first?")).toBe(true);
  });

  it("keeps a question with its answer, context as context, and both for a message that does both", async () => {
    const settings = setup();
    const ask = (kind: string, reply = "It saved two hours a week.") => async () => JSON.stringify({ kind, reply });
    expect(await answerInThread(settings, { topic: ID, title: "T", user: OPERATOR, text: "Why first?", now: NOW }, ask("question"))).toBe("It saved two hours a week.");
    await answerInThread(settings, { topic: ID, title: "T", user: OPERATOR, text: "Stress the cost.", now: NOW }, ask("context", "Thanks, the writer will get it."));
    await answerInThread(settings, { topic: ID, title: "T", user: OPERATOR, text: "It ran a month; was it worth it?", now: NOW }, ask("both"));
    expect(readFeedback(settings.dataDir).map((e) => [e.by === "ghostpen" ? "ghostpen" : "me", e.kind, e.text])).toEqual([
      ["me", "question", "Why first?"], ["ghostpen", "answer", "It saved two hours a week."],
      ["me", "context", "Stress the cost."], ["ghostpen", "answer", "Thanks, the writer will get it."],
      ["me", "context", "It ran a month; was it worth it?"], ["me", "question", "It ran a month; was it worth it?"], ["ghostpen", "answer", "It saved two hours a week."]]);
  });

  it("never loses the message: a failed answer, or no command, keeps it as context and says so", async () => {
    const settings = setup();
    expect(await answerInThread(settings, { topic: ID, title: "T", user: OPERATOR, text: "Note A", now: NOW }, async () => "not json"))
      .toBe("Kept your message as context for this topic, but ghostpen could not answer it: the answer was not the JSON asked for.");
    expect(await answerInThread(settings, { topic: ID, title: "T", user: OPERATOR, text: "Note B", now: NOW }))
      .toMatch(/^Kept as context for this topic\. ghostpen has no writer or scorer set here/u);
    expect(readFeedback(settings.dataDir).map((e) => [e.kind, e.text])).toEqual([["context", "Note A"], ["context", "Note B"]]);
  });

  it("checks the answer's shape and clips a long reply", () => {
    expect(parseThreadAnswer('```json\n{"kind": "question", "reply": " Yes. "}\n```')).toEqual({ kind: "question", reply: "Yes." });
    expect(parseThreadAnswer(JSON.stringify({ kind: "both", reply: "x".repeat(3000) })).reply).toHaveLength(1901);
    for (const bad of ["{}", '{"kind": "chat", "reply": "x"}', '{"kind": "question", "reply": ""}', "nope"]) expect(() => parseThreadAnswer(bad)).toThrow("not the JSON asked for");
  });
});

/** A running service over `setup()`, the adapter's settings file, and a fake chatter that records posts. */
async function world(over: Record<string, unknown> = {}) {
  const settings = setup(over);
  const server = createGhostpenServer({ instance: "host", dataDir: settings.dataDir, settings, adapterKey: KEY, now: () => NOW.getTime() });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const settingsFile = join(settings.dataDir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ instance: "host", port: (server.address() as { port: number }).port, dataDir: settings.dataDir, adapterKeyFile: settings.adapterKeyFile }));
  const posts: Array<{ channel: string; text: string; thread?: unknown }> = [];
  const ctx = { config: { settingsFile }, log: () => {},
    postToChannel: async (channel: string, content: { text: string; thread?: unknown }, _b: Button[] = []) => { posts.push({ channel, text: content.text, thread: content.thread }); return { channelRef: channel, messageRef: `p${posts.length}`, threadRef: `th${posts.length}` }; } };
  return { settings, ctx, posts };
}
const waitFor = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 20)); };

describe("thread messages in chatter", () => {
  it("handles a message in a card's thread at once and posts the answer into the thread", async () => {
    const { ctx, posts, settings } = await world();
    const message = (over: Record<string, unknown>) => ({ type: "message", is_thread: true, channel_id: "t1", user_id: OPERATOR, text: "Keep it short.", ...over });
    expect(await answerThreadMessage(message({}), ctx)).toEqual({ handled: true });
    await waitFor(() => posts.length > 0);
    // No writer or scorer in these settings: the message is kept as context, and the reply says so.
    expect(posts[0]).toMatchObject({ channel: "t1", text: expect.stringMatching(/^Kept as context for this topic\./u) });
    expect(readFeedback(settings.dataDir).map((e) => [e.topic, e.kind, e.text])).toEqual([[ID, "context", "Keep it short."]]);
    expect(await answerThreadMessage(message({ user_id: "1" }), ctx)).toEqual({ handled: true });
    await waitFor(() => posts.length > 1);
    expect(posts[1]!.text).toBe("ghostpen takes questions and context from the operator only.");
    expect(await answerThreadMessage(message({ text: "  " }), ctx)).toEqual({ handled: true });
    await waitFor(() => posts.length > 2);
    expect(posts[2]!.text).toBe("That message was empty, so nothing was kept.");
  });

  it("leaves every other message to chatter", async () => {
    const { ctx, posts } = await world();
    expect(await answerThreadMessage({ type: "message", is_thread: true, channel_id: "someone-elses-thread", user_id: OPERATOR, text: "hi" }, ctx)).toBeUndefined();
    expect(await answerThreadMessage({ type: "message", is_thread: false, channel_id: "t1", user_id: OPERATOR, text: "hi" }, ctx)).toBeUndefined();
    expect(await answerThreadMessage({ type: "button_click", button_id: "x" }, ctx)).toBeUndefined();
    const lost = { ...ctx, config: { settingsFile: "/nonexistent/settings.json" } };
    expect(await answerThreadMessage({ type: "message", is_thread: true, channel_id: "t1", user_id: OPERATOR, text: "hi" }, lost)).toBeUndefined();
    expect(await adapter.onMessage({ type: "message", is_thread: true, channel_id: "t1", user_id: OPERATOR, text: "via onMessage" }, ctx as never)).toEqual({ handled: true });
    await waitFor(() => posts.length > 0);
    expect(posts).toHaveLength(1);
  });

  it("opens a thread under each new card and keeps where it went", async () => {
    const { ctx, posts, settings } = await world({ shortlist: { operator: OPERATOR, channel: "1563701613099745320", count: 3 } });
    saveShortlists(settings.dataDir, { version: 1, weeks: {} });
    await syncShortlist(ctx, new Set());
    expect(posts[0]!.thread).toEqual({ name: "one timer app (Decision post, score 6)" });
    await waitFor(() => threadTopic(settings.dataDir, "th1") !== null);
    expect(threadTopic(settings.dataDir, "th1")?.topic).toBe(ID);
  });
});

describe("context reaches the writer and the app page", () => {
  it("tells the writer the author's context as true", () => {
    const prompt = writerPrompt({ kind: "decision", subject: "s", documents: [], parts: [], graph: null, voice: [], context: ["We tried three timers\nfirst."] });
    expect(prompt).toContain("The author added this context about the topic. It is true; use it where it fits:\n- We tried three timers first.");
    expect(writerPrompt({ kind: "decision", subject: "s", documents: [], parts: [], graph: null, voice: [] })).not.toContain("The author added this context");
  });

  it("shows context with its topic and every note, newest first, escaped", () => {
    const view = { ranAt: "x", problems: [], background: [], owed: [], entries: [{ id: ID, kind: "decision", title: "t", topic: "one timer app", takeaway: "k", total: 6, explain: [], location: "l", scores: [] }] };
    const notes = [{ at: "1", by: OPERATOR, topic: ID, kind: "context" as const, text: "<b>We tried three</b>", intake: "pending" as const },
      { at: "2", by: OPERATOR, topic: ID, kind: "reason" as const, action: "write", chip: true, text: "Others would find it useful", intake: "pending" as const }];
    const html = renderApp("host", { login: "tim" }, view, notes);
    expect(html).toContain('<ul data-field="context"><li>Your context: &lt;b&gt;We tried three&lt;/b&gt;</li></ul>');
    expect(html.indexOf("Reason (write)")).toBeLessThan(html.indexOf("<strong>Context</strong>"));
    expect(renderApp("host", { login: "tim" }, view, [])).not.toContain('data-section="notes"');
    expect(renderApp("host", { login: "tim" }, view, new Error("feedback.json is not ghostpen's feedback file"))).toContain("It cannot be read: feedback.json is not ghostpen&#39;s feedback file");
  });
});
