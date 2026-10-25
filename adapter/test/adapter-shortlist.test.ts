import { writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answerShortlistPress, syncShortlist, type Button } from "../src/adapter/shortlist.js";
import { readChoices } from "../src/ranking/choices.js";
import { RANKING_FILE } from "../src/ranking/run.js";
import { createGhostpenServer } from "../src/service/server.js";
import { parseSettings } from "../src/settings.js";
import { KEY, keyFile, tempDir } from "./helpers.js";

const OPERATOR = "234652039735541760";
const entry = (id: string, total: number) => ({ id, kind: "decision", title: id, topic: `Topic ${id}`, takeaway: "", total, explain: [], location: "l",
  scores: [{ factor: "stakes", score: 3, quote: "CI is the main delivery bottleneck", line: 2, location: "l:2" }] });

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))); });

/** A running service with a ranking and a channel, the settings file the adapter reads, and a fake chatter. */
async function world(over: Record<string, unknown> = {}) {
  const dir = tempDir();
  writeFileSync(join(dir, RANKING_FILE), JSON.stringify({ ranAt: "x", problems: [], owed: [], background: [], entries: ["a", "b", "c", "d"].map((id, i) => entry(id, 9 - i)) }));
  const raw = { instance: "host", port: 8794, dataDir: dir, adapterKeyFile: keyFile(dir),
    shortlist: { operator: OPERATOR, channel: "1563701613099745320", count: 3 }, ...over };
  const server = createGhostpenServer({ instance: "host", dataDir: dir, settings: parseSettings(raw), adapterKey: KEY, now: () => Date.parse("2026-10-26T10:00:00Z") });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ ...raw, port: (server.address() as { port: number }).port }));
  const posts: Array<{ channel: string; text: string; ping?: string; buttons: Button[] }> = [];
  const edits: Array<{ messageRef: string; text: string; buttons: Button[] }> = [];
  const logs: string[] = [];
  const ctx = { config: { settingsFile }, log: (_l: string, event: string) => { logs.push(event); },
    postToChannel: async (channel: string, content: { text: string; singleUserNotification?: { userId: string } }, buttons: Button[] = []) => {
      posts.push({ channel, text: content.text, ping: content.singleUserNotification?.userId, buttons });
      return { channelRef: channel, messageRef: `m${posts.length}` };
    },
    updatePostedMessage: async (_c: string, messageRef: string, content: { text: string }, buttons: Button[] = []) => { edits.push({ messageRef, text: content.text, buttons }); return true; } };
  return { dir, ctx, posts, edits, logs };
}

describe("the shortlist in chatter", () => {
  it("posts the week's cards once, pinging the operator on the first only, and redraws unanswered ones once after a restart", async () => {
    const { ctx, posts, edits } = await world();
    expect(await syncShortlist(ctx, new Set())).toBe(3);
    expect(posts.map((p) => [p.channel, p.ping, p.buttons.map((b) => b.label)])).toEqual([
      ["1563701613099745320", OPERATOR, ["Write", "Skip", "Not yet"]], ["1563701613099745320", undefined, ["Write", "Skip", "Not yet"]],
      ["1563701613099745320", undefined, ["Write", "Skip", "Not yet"]]]);
    expect(posts[0]!.buttons[0]!.id).toBe("ghostpen.shortlist:write:2026-10-26:0"); // owner first, as chatter needs
    const sameRun = new Set(["2026-10-26:0", "2026-10-26:1", "2026-10-26:2"]);
    expect(await syncShortlist(ctx, sameRun)).toBe(0);
    expect(posts).toHaveLength(3);
    // A new adapter run (chatter restarted): each unanswered card is redrawn once, re-arming its buttons.
    const restarted = new Set<string>();
    await syncShortlist(ctx, restarted);
    await syncShortlist(ctx, restarted);
    expect(edits.map((e) => [e.messageRef, e.buttons.length])).toEqual([["m1", 3], ["m2", 3], ["m3", 3]]);
  });

  it("takes Write, asks Skip for its reason first, refuses anyone but the operator, and edits the card to the answer", async () => {
    const { ctx, edits, dir } = await world();
    await syncShortlist(ctx, new Set());
    const press = (id: string, user = OPERATOR, text?: string) => answerShortlistPress({ type: "button_click", button_id: `ghostpen.${id}`, user_id: user, ...(text !== undefined ? { text } : {}) }, ctx);
    expect(await press("shortlist:write:2026-10-26:0", "999999")).toEqual({ handled: true, reply_text: "Only the operator can answer ghostpen's shortlist, so nothing was done." });
    expect(await press("shortlist:write:2026-10-26:0")).toEqual({ handled: true, reply_text: "Noted. No draft writer is set here (settings.draft), so nothing is drafted." });
    expect(edits.at(-1)).toMatchObject({ messageRef: "m1", buttons: [] });
    expect(edits.at(-1)!.text).toContain("**Write: next to draft**");
    const asked = await press("shortlist:skip:2026-10-26:1");
    expect(asked).toMatchObject({ handled: true, ask: { title: "Why skip this topic?", maxLength: 200 } });
    expect(await press("shortlist:skip:2026-10-26:1", OPERATOR, "too narrow")).toEqual({ handled: true, reply_text: "Skipped; the reason will tune the ranking." });
    expect(await press("shortlist:later:2026-10-26:2")).toEqual({ handled: true, reply_text: "It comes back in a later week." });
    expect(await press("shortlist:skip:2026-10-26:0", OPERATOR, "x")).toEqual({ handled: true, reply_text: "This topic was answered already; its card shows the answer." });
    expect(readChoices(dir).choices.map((c) => [c.candidate, c.choice, c.reason])).toEqual([["a", "write", ""], ["b", "skip", "too narrow"], ["c", "not-yet", ""]]);
    // After a restart, an answered card is never redrawn with its buttons back, nor posted again.
    const editsBefore = edits.length;
    expect(await syncShortlist(ctx, new Set())).toBe(0);
    expect(edits).toHaveLength(editsBefore);
  });

  it("leaves other presses to chatter, refuses a malformed one, and says when the service cannot be reached", async () => {
    const { ctx } = await world();
    expect(await answerShortlistPress({ type: "button_click", button_id: "clock.clock-alert:rerun:x" }, ctx)).toBeUndefined();
    expect(await answerShortlistPress({ type: "message", text: "hi" }, ctx)).toBeUndefined();
    expect(await answerShortlistPress({ type: "button_click", button_id: "ghostpen.shortlist:delete:w:1" }, ctx))
      .toEqual({ handled: true, reply_text: "ghostpen does not know that button, so nothing was done." });
    const lost = { ...ctx, config: { settingsFile: "/nonexistent/settings.json" } };
    expect((await answerShortlistPress({ type: "button_click", button_id: "ghostpen.shortlist:write:2026-10-26:0", user_id: OPERATOR }, lost) as { reply_text: string }).reply_text)
      .toMatch(/^ghostpen could not take the answer, so nothing was done: settings:/u);
  });

  it("posts nothing while the service says the shortlist is off", async () => {
    const { ctx, posts } = await world({ shortlist: undefined });
    expect(await syncShortlist(ctx, new Set())).toBe("off");
    expect(posts).toEqual([]);
  });
});
