import { writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFeedback } from "../src/feedback/store.js";
import { readChoices } from "../src/ranking/choices.js";
import { RANKING_FILE, type RankingView } from "../src/ranking/run.js";
import { createGhostpenServer } from "../src/service/server.js";
import { parseSettings } from "../src/settings.js";
import { picks, proposalText } from "../src/shortlist/picks.js";
import { checkSlot, currentWeek } from "../src/shortlist/schedule.js";
import { KEY, tempDir } from "./helpers.js";

const entry = (id: string, total: number, explain: string[] = [], kind = "decision") => ({ id, kind, title: `ADR ${id}`, topic: `Topic ${id}`,
  takeaway: `Takeaway ${id}`, total, explain, location: `/o/${id}.md:1`,
  scores: [{ factor: "stakes", score: 3, quote: "CI is the main delivery bottleneck", line: 2, location: `/o/${id}.md:2` },
    { factor: "carryOver", score: 0, quote: "", line: null, note: "its quote is not in the source", location: `/o/${id}.md` }] });
const view = (over: Partial<RankingView> = {}): RankingView => ({ ranAt: "2026-10-25T07:40:00Z", problems: [], owed: [],
  entries: ["a", "b", "c", "d", "e", "f"].map((id, i) => entry(id, 10 - i, id === "a" || id === "b" ? ["ci"] : [])), background: [{ part: "ci", unlocks: ["a", "b"] }], ...over });

describe("the weekly slot", () => {
  const slot = checkSlot("monday", "09:00", "America/New_York");
  it("names the week by its slot's local date: last week's until this week's slot passes", () => {
    expect(currentWeek(slot, new Date("2026-10-26T12:59:00Z"))).toBe("2026-10-19"); // Monday 08:59 in New York
    expect(currentWeek(slot, new Date("2026-10-26T13:00:00Z"))).toBe("2026-10-26"); // Monday 09:00
    expect(currentWeek(slot, new Date("2026-11-01T23:00:00Z"))).toBe("2026-10-26"); // Sunday evening, still that week
  });
  it("keeps the local time across a change from summer time", () => {
    // New York leaves summer time on 2026-11-01: 09:00 local is 14:00 UTC the Monday after.
    expect(currentWeek(slot, new Date("2026-11-02T13:30:00Z"))).toBe("2026-10-26");
    expect(currentWeek(slot, new Date("2026-11-02T14:00:00Z"))).toBe("2026-11-02");
  });
  it("refuses a day, time or time zone it cannot use, naming the field", () => {
    expect(() => checkSlot("funday", "09:00", "UTC")).toThrow("shortlist.day");
    expect(() => checkSlot("monday", "9am", "UTC")).toThrow("shortlist.time");
    expect(() => checkSlot("monday", "09:00", "Mars/Olympus")).toThrow("shortlist.timeZone");
  });
});

describe("the picks", () => {
  const fresh = { version: 1 as const, weights: {}, choices: [], bookings: [] };
  it("takes the top open topics and ranks in a background post that unlocks two of them", () => {
    const items = picks(view(), fresh, 5);
    expect(items.map((i) => i.id)).toEqual(["background:ci", "a", "b", "c", "d"]);
    expect(items[0]!.text).toContain("2 of this week's topics mention ci");
    const text = proposalText(entry("a", 10, ["ci"]), 1);
    expect(text).toBe('**#1 Topic a** (Decision post, score 10)\nWhy: stakes 3/3: "CI is the main delivery bottleneck"\nA reader leaves with: Takeaway a\nNeeds first: a post explaining ci.');
  });
  it("leaves out what Tim wrote or skipped, brings back Not yet, and adds no background post that unlocks only one", () => {
    const answered = { ...fresh, choices: [{ candidate: "a", choice: "write" as const, reason: "", at: "", scores: [] },
      { candidate: "c", choice: "skip" as const, reason: "narrow", at: "", scores: [] }, { candidate: "d", choice: "not-yet" as const, reason: "", at: "", scores: [] }] };
    expect(picks(view(), answered, 3).map((i) => i.id)).toEqual(["b", "d", "e"]);
  });
});

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))); });

async function service(over: Record<string, unknown> = {}, ranking: unknown = view(), nowIso = "2026-10-26T13:05:00Z") {
  const dataDir = tempDir();
  if (ranking) writeFileSync(join(dataDir, RANKING_FILE), JSON.stringify(ranking));
  const facts = join(dataDir, "instance-facts.json");
  writeFileSync(facts, JSON.stringify({ adapterChannels: { ghostpen: { name: "ghostpen", channelId: "1563701613099745320" } } }));
  const settings = parseSettings({ instance: "host", port: 8794, dataDir, instanceFactsFile: facts,
    shortlist: { operator: "234652039735541760", day: "monday", time: "09:00", timeZone: "America/New_York", count: 3 }, ...over });
  let now = Date.parse(nowIso);
  const server = createGhostpenServer({ instance: "host", dataDir, settings, adapterKey: KEY, now: () => now });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, path: string, body?: unknown, key = KEY) => {
    const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${key.toString("base64url")}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  return { call, dataDir, setNow: (iso: string) => { now = Date.parse(iso); } };
}

describe("the adapter routes", () => {
  it("answer 404 to anyone without the adapter key", async () => {
    const { call } = await service();
    expect((await call("GET", "/v1/adapter/shortlist", undefined, Buffer.alloc(32, 9))).status).toBe(404);
  });

  it("make this week's shortlist once, from the last ranking, for the channel chatter made for ghostpen", async () => {
    const { call } = await service();
    const first = await call("GET", "/v1/adapter/shortlist");
    expect(first.body).toMatchObject({ week: "2026-10-26", channel: "1563701613099745320", operator: "234652039735541760" });
    expect(first.body.items.map((i: any) => [i.index, i.id, i.answered])).toEqual([[0, "background:ci", false], [1, "a", false], [2, "b", false]]);
    const again = await call("GET", "/v1/adapter/shortlist");
    expect(again.body.items.map((i: any) => i.id)).toEqual(["background:ci", "a", "b"]); // fixed for the week
  });

  it("say why nothing is due: no shortlist set, no channel yet, nothing ranked yet", async () => {
    expect((await (await service({ shortlist: undefined })).call("GET", "/v1/adapter/shortlist")).body).toEqual({ off: "no shortlist is set (settings.shortlist)" });
    expect((await (await service({ instanceFactsFile: "/nonexistent/facts.json" })).call("GET", "/v1/adapter/shortlist")).body.off).toMatch(/no channel yet/u);
    expect((await (await service({}, null)).call("GET", "/v1/adapter/shortlist")).body).toEqual({ waiting: "nothing is ranked yet" });
  });

  it("keep where a card was posted, take only the operator's press, need a reason for Skip, and record every choice", async () => {
    const { call, dataDir, setNow } = await service();
    const { week } = (await call("GET", "/v1/adapter/shortlist")).body;
    expect((await call("POST", "/v1/adapter/shortlist/posted", { week, index: 1, channelRef: "c1", messageRef: "m1" })).body).toEqual({ ok: true });
    expect((await call("POST", "/v1/adapter/shortlist/answer", { week, index: 1, action: "write", reason: "useful", user: "1234567" })).body.refused)
      .toBe("Only the operator can answer ghostpen's shortlist, so nothing was done.");
    expect((await call("POST", "/v1/adapter/shortlist/answer", { week, index: 2, action: "skip", reason: " ", user: "234652039735541760" })).body.refused)
      .toBe("A Skip needs a reason, so nothing was done.");
    // Every press needs its reason now, a Write and a Not yet too (ADR 0101, amended 2026-10-25).
    expect((await call("POST", "/v1/adapter/shortlist/answer", { week, index: 1, action: "write", user: "234652039735541760" })).body.refused)
      .toBe("A Write needs a reason, so nothing was done.");
    expect((await call("POST", "/v1/adapter/shortlist/answer", { week, index: 0, action: "later", reason: "", user: "234652039735541760" })).body.refused)
      .toBe("A Not yet needs a reason, so nothing was done.");
    const wrote = await call("POST", "/v1/adapter/shortlist/answer", { week, index: 1, action: "write", reason: "Others would find it useful", chip: true, user: "234652039735541760" });
    expect(wrote.body.posted).toEqual({ channelRef: "c1", messageRef: "m1" });
    expect(wrote.body.text).toMatch(/\*\*Write: next to draft\*\* \(<@234652039735541760>: Others would find it useful\)$/u);
    const skipped = await call("POST", "/v1/adapter/shortlist/answer", { week, index: 2, action: "skip", reason: "too narrow", user: "234652039735541760" });
    expect(skipped.body.text).toMatch(/\*\*Skipped\*\* \(<@234652039735541760>: too narrow\)$/u);
    await call("POST", "/v1/adapter/shortlist/answer", { week, index: 0, action: "later", reason: "waiting", user: "234652039735541760" });
    expect((await call("POST", "/v1/adapter/shortlist/answer", { week, index: 1, action: "skip", reason: "x", user: "234652039735541760" })).body.already).toBe(true);
    const choices = readChoices(dataDir);
    expect(choices.choices.map((c) => [c.candidate, c.choice, c.reason])).toEqual([["a", "write", "Others would find it useful"], ["b", "skip", "too narrow"],
      ["background:ci", "not-yet", "waiting"]]);
    // Every reason is kept for chatter's operator intake, with whether it was one of the card's choices.
    expect(readFeedback(dataDir).map((e) => [e.topic, e.kind, e.action, e.chip, e.text, e.intake])).toEqual([
      ["a", "reason", "write", true, "Others would find it useful", "pending"], ["b", "reason", "skip", false, "too narrow", "pending"],
      ["background:ci", "reason", "later", false, "waiting", "pending"]]);
    expect(choices.bookings.map((b) => b.decision)).toEqual(["a"]); // a decision post written books its post-mortem
    // Next week: written and skipped are gone, Not yet comes back.
    setNow("2026-11-02T14:05:00Z");
    expect((await call("GET", "/v1/adapter/shortlist")).body.items.map((i: any) => i.id)).toEqual(["c", "d", "e"]);
  });

  it("refuse a shortlist setting it cannot use, naming the field", () => {
    const base = { instance: "x", port: 8794, dataDir: "/d" };
    expect(() => parseSettings({ ...base, shortlist: { operator: "tim" } })).toThrow("shortlist.operator must be a Discord user id");
    expect(() => parseSettings({ ...base, shortlist: { operator: "123456", count: 6 } })).toThrow("shortlist.count must be 3 to 5");
    expect(parseSettings({ ...base, shortlist: { operator: "123456" } }).shortlist).toEqual({ day: "monday", time: "09:00", timeZone: "UTC", operator: "123456", count: 5 });
  });
});
