import { writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answerDraftPress } from "../src/adapter/drafts.js";
import adapter from "../src/adapter/index.js";
import { syncShortlist, type Button } from "../src/adapter/shortlist.js";
import { createGhostpenServer } from "../src/service/server.js";
import { parseSettings } from "../src/settings.js";
import { readShortlists, saveShortlists, type DraftState } from "../src/shortlist/state.js";
import { KEY, keyFile, tempDir } from "./helpers.js";

const OPERATOR = "234652039735541760";
const WEEK = "2026-10-26";
const PR = { number: 7, url: "https://github.com/o/blog/pull/7", branch: "ghostpen/t" };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))); });

/** A service whose week has one answered (Write) item with `draft`, the adapter's settings file, and a fake chatter. */
async function world(draft: DraftState) {
  const dir = tempDir();
  const raw = { instance: "host", port: 8794, dataDir: dir, adapterKeyFile: keyFile(dir), shortlist: { operator: OPERATOR, channel: "1563701613099745320", count: 3 } };
  saveShortlists(dir, { version: 1, weeks: { [WEEK]: { madeAt: "x", items: [{ id: "d:1", kind: "decision", text: "**#1 Topic**",
    posted: { channelRef: "c", messageRef: "m0" }, answer: { action: "write", reason: "", by: OPERATOR, at: "x" }, draft }] } } });
  const server = createGhostpenServer({ instance: "host", dataDir: dir, settings: parseSettings(raw), adapterKey: KEY, now: () => Date.parse("2026-10-26T14:00:00Z") });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ ...raw, port: (server.address() as { port: number }).port }));
  const posts: Array<{ text: string; buttons: Button[] }> = [];
  const edits: Array<{ messageRef: string; text: string; buttons: Button[] }> = [];
  const ctx = { config: { settingsFile }, log: () => {},
    postToChannel: async (_channel: string, content: { text: string }, buttons: Button[] = []) => { posts.push({ text: content.text, buttons }); return { channelRef: "c", messageRef: `d${posts.length}` }; },
    updatePostedMessage: async (_c: string, messageRef: string, content: { text: string }, buttons: Button[] = []) => { edits.push({ messageRef, text: content.text, buttons }); return true; } };
  const setDraft = (change: Partial<DraftState>) => {
    const state = readShortlists(dir);
    Object.assign(state.weeks[WEEK]!.items[0]!.draft!, change);
    saveShortlists(dir, state);
  };
  return { dir, ctx, posts, edits, setDraft, draft: () => readShortlists(dir).weeks[WEEK]!.items[0]!.draft! };
}

describe("draft cards in chatter", () => {
  it("posts nothing while drafting, then one card per new state, taking the buttons off the card before it", async () => {
    const w = await world({ status: "drafting", round: 1, at: "x" });
    expect(await syncShortlist(w.ctx, new Set())).toBe(0);
    w.setDraft({ status: "ready", title: "T", report: "All checks passed.", pr: PR });
    const redrawn = new Set<string>();
    expect(await syncShortlist(w.ctx, redrawn)).toBe(1);
    expect(w.posts[0]!.text).toContain("**Draft ready: T**");
    expect(w.posts[0]!.buttons).toEqual([{ label: "Publish", style: "success", id: `ghostpen.draft:publish:${WEEK}:0:1` }, { label: "Edit", style: "secondary", id: `ghostpen.draft:edit:${WEEK}:0:1` }]);
    expect(w.draft().card).toEqual({ channelRef: "c", messageRef: "d1", round: 1, status: "ready" });
    expect(await syncShortlist(w.ctx, redrawn)).toBe(0); // nothing new
    w.setDraft({ status: "published" });
    expect(await syncShortlist(w.ctx, redrawn)).toBe(1);
    expect(w.posts[1]).toEqual({ text: "**Published: T**\nhttps://github.com/o/blog/pull/7", buttons: [] });
    expect(w.edits).toEqual([{ messageRef: "d1", text: "This draft moved on; the newest card about it is below.", buttons: [] }]);
  });

  it("redraws a card with buttons once after a restart, never one without", async () => {
    const w = await world({ status: "ready", round: 2, title: "T", pr: PR, at: "x", card: { channelRef: "c", messageRef: "d9", round: 2, status: "ready" } });
    const restarted = new Set<string>();
    await syncShortlist(w.ctx, restarted);
    await syncShortlist(w.ctx, restarted);
    expect(w.posts).toEqual([]);
    expect(w.edits.map((e) => [e.messageRef, e.buttons.map((b) => b.id)])).toEqual([["d9", [`ghostpen.draft:publish:${WEEK}:0:2`, `ghostpen.draft:edit:${WEEK}:0:2`]]]);
    const held = await world({ status: "held", round: 1, title: "T", at: "x", card: { channelRef: "c", messageRef: "d9", round: 1, status: "held" } });
    await syncShortlist(held.ctx, new Set());
    expect(held.edits).toEqual([]);
  });

  it("asks Edit for the changes, then sends them; refuses old cards, strangers and unknown buttons", async () => {
    const w = await world({ status: "failed", round: 1, title: "T", report: "r", at: "x" });
    const press = (id: string, over: Record<string, unknown> = {}) => answerDraftPress({ type: "button_click", button_id: id, user_id: OPERATOR, ...over }, w.ctx);
    expect(await press(`ghostpen.draft:edit:${WEEK}:0:1`)).toEqual({ handled: true,
      ask: { title: "What should change?", label: "The changes, in plain words", placeholder: "e.g. shorter intro; explain what Relay is", maxLength: 2000 } });
    expect(await press(`ghostpen.draft:edit:${WEEK}:0:1`, { text: "Shorter." })).toEqual({ handled: true, reply_text: "ghostpen is not drafting here (settings.draft), so nothing was done." });
    expect(await press(`ghostpen.draft:edit:${WEEK}:0:0`, { text: "x" })).toEqual({ handled: true, reply_text: "This card is for an older draft; use the newest card. Nothing was done." });
    expect(await press(`ghostpen.draft:publish:${WEEK}:0:1`, { user_id: "1" })).toMatchObject({ reply_text: expect.stringContaining("Only the operator") });
    expect(await press(`ghostpen.draft:publish:${WEEK}:0:1`)).toEqual({ handled: true, reply_text: "This draft is not ready to publish, so nothing was done." });
    expect(await press("ghostpen.draft:delete:x:0:1")).toEqual({ handled: true, reply_text: "ghostpen does not know that button, so nothing was done." });
    expect(await press("ghostpen.shortlist:write:x:0")).toBeUndefined();
    expect(await answerDraftPress({ type: "message" }, w.ctx)).toBeUndefined();
  });

  it("reaches draft presses through the adapter's onMessage", async () => {
    const w = await world({ status: "failed", round: 1, at: "x" });
    expect(await adapter.onMessage({ type: "button_click", button_id: `ghostpen.draft:publish:${WEEK}:0:1`, user_id: OPERATOR }, w.ctx as never))
      .toEqual({ handled: true, reply_text: "This draft is not ready to publish, so nothing was done." });
  });

  it("says so when the service can't be reached", async () => {
    const w = await world({ status: "ready", round: 1, at: "x" });
    await new Promise((done) => servers.pop()!.close(done));
    const reply = await answerDraftPress({ type: "button_click", button_id: `ghostpen.draft:publish:${WEEK}:0:1`, user_id: OPERATOR }, w.ctx);
    expect(reply).toMatchObject({ handled: true, reply_text: expect.stringContaining("ghostpen could not take the press, so nothing was done") });
  });
});
