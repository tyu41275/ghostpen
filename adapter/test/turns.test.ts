import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGhostpenServer } from "../src/service/server.js";
import { CLAIM_WAIT_MS, TURN_CLAIM_PATH, turnRoute } from "../src/service/turn-routes.js";
import { parseSettings } from "../src/settings.js";
import { ANSWER_GRACE_MS, TurnQueue, type Claim } from "../src/turns/queue.js";
import { ranOf } from "../src/turns/ran.js";
import { KEY, keyFile, tempDir } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

const CHATTER = { persona: "ghostpen.scorer", provider: "claude", model: "a-model", effort: null, thinkingLevel: "a-level", account: "acct" };
const claimNow = (queue: TurnQueue) => queue.claim(0).next as Promise<Claim>;

describe("the turn queue", () => {
  it("hands a turn to a claim and resolves the answer with what it ran on", async () => {
    const queue = new TurnQueue();
    const asked = queue.ask("ghostpen.scorer", "scorer-v3", "score this", 60_000);
    const claim = await claimNow(queue);
    expect(claim).toEqual({ id: expect.any(String), persona: "ghostpen.scorer", instructionsVersion: "scorer-v3", prompt: "score this", timeoutMs: 60_000 });
    expect(queue.answer(claim.id, { ok: true, text: "{\"stakes\": 3}", ...CHATTER })).toBe(true);
    expect(await asked).toEqual({ text: "{\"stakes\": 3}", ran: { persona: "ghostpen.scorer", instructionsVersion: "scorer-v3", provider: "claude",
      model: "a-model", effort: null, thinkingLevel: "a-level" } });
    expect(queue.size).toEqual({ queued: 0, claimed: 0 });
  });

  it("hands a turn asked later to a claim already waiting, and answers a claim that waited out with none", async () => {
    vi.useFakeTimers();
    const queue = new TurnQueue();
    const waiting = queue.claim(CLAIM_WAIT_MS).next;
    void queue.ask("ghostpen.writer", "w1", "write", 60_000).catch(() => {});
    expect((await waiting)?.persona).toBe("ghostpen.writer");
    const empty = queue.claim(CLAIM_WAIT_MS).next;
    await vi.advanceTimersByTimeAsync(CLAIM_WAIT_MS);
    expect(await empty).toBeNull();
  });

  it("rejects in words a turn nobody claims, one claimed and never answered, and one answered as failed or empty", async () => {
    vi.useFakeTimers();
    const queue = new TurnQueue();
    const unclaimed = expect(queue.ask("ghostpen.scorer", "v1", "p", 5_000)).rejects
      .toThrow("nobody took ghostpen's ghostpen.scorer turn within 5 s: ghostpen's adapter in chatter claims its turns, so it is off, or this chatter does not run model turns for adapters");
    await vi.advanceTimersByTimeAsync(5_000);
    await unclaimed;
    expect(queue.size).toEqual({ queued: 0, claimed: 0 });

    const unanswered = queue.ask("ghostpen.writer", "v1", "p", 5_000);
    const claim = await claimNow(queue);
    const said = expect(unanswered).rejects.toThrow(`ghostpen's adapter took the ghostpen.writer turn but no answer came back within ${5 + ANSWER_GRACE_MS / 1000} s`);
    await vi.advanceTimersByTimeAsync(5_000 + ANSWER_GRACE_MS);
    await said;
    expect(queue.answer(claim.id, { ok: true, text: "late" })).toBe(false);

    const failed = queue.ask("ghostpen.scorer", "v1", "p", 5_000);
    queue.answer((await claimNow(queue)).id, { ok: false, why: "the account's usage limit\nsecond line" });
    await expect(failed).rejects.toThrow("ghostpen's ghostpen.scorer turn failed: the account's usage limit");
    const empty = queue.ask("ghostpen.scorer", "v1", "p", 5_000);
    queue.answer((await claimNow(queue)).id, { ok: true, text: "  " });
    await expect(empty).rejects.toThrow("ghostpen's ghostpen.scorer turn failed: the answer was empty");
    const long = queue.ask("ghostpen.scorer", "v1", "p", 5_000);
    queue.answer((await claimNow(queue)).id, { ok: true, text: "x".repeat(100_001) });
    await expect(long).rejects.toThrow("the answer was 100001 characters, over 100000");
  });

  it("refuses at once a turn chatter would refuse", async () => {
    const queue = new TurnQueue();
    await expect(queue.ask("ghostpen.other" as never, "v1", "p", 5_000)).rejects.toThrow("ghostpen has no ghostpen.other turns");
    await expect(queue.ask("ghostpen.scorer", "", "p", 5_000)).rejects.toThrow("instructions version must be 1 to 128 characters");
    await expect(queue.ask("ghostpen.scorer", "v1", "x".repeat(400_001), 5_000)).rejects.toThrow("prompt is 400001 characters, over chatter's 400000");
    await expect(queue.ask("ghostpen.scorer", "v1", "p", 31 * 60_000)).rejects.toThrow("time must be 1 s to 30 minutes");
    expect(queue.size).toEqual({ queued: 0, claimed: 0 });
  });

  it("ignores an answer for an unknown id or a turn that already ended", async () => {
    const queue = new TurnQueue();
    expect(queue.answer("no-such-turn", { ok: true, text: "x" })).toBe(false);
    const asked = queue.ask("ghostpen.scorer", "v1", "p", 5_000);
    const { id } = await claimNow(queue);
    expect(queue.answer(id, { ok: true, text: "first" })).toBe(true);
    expect(queue.answer(id, { ok: true, text: "second" })).toBe(false);
    expect((await asked).text).toBe("first");
  });

  it("puts thread answers first and keeps each kind's order, a turn put back at the head of its kind", async () => {
    const queue = new TurnQueue();
    const ask = (persona: "ghostpen.scorer" | "ghostpen.writer" | "ghostpen.thread-answer", prompt: string) =>
      void queue.ask(persona, "v1", prompt, 60_000).catch(() => {});
    ask("ghostpen.scorer", "s1"); ask("ghostpen.scorer", "s2"); ask("ghostpen.thread-answer", "t1"); ask("ghostpen.writer", "w1");
    ask("ghostpen.thread-answer", "t2");
    const first = await claimNow(queue);
    expect(first.prompt).toBe("t1");
    expect(queue.release(first.id)).toBe(true);
    const order: string[] = [];
    for (let i = 0; i < 5; i += 1) order.push((await claimNow(queue)).prompt);
    expect(order).toEqual(["t1", "t2", "s1", "s2", "w1"]);
    expect(await queue.claim(0).next).toBeNull();
  });

  it("ends a claim whose request went away, and puts back a turn handed to one as it went", async () => {
    const queue = new TurnQueue();
    const away = new AbortController();
    const ended = turnRoute(queue, "POST", TURN_CLAIM_PATH, {}, away.signal) as Promise<{ body: unknown }>;
    away.abort();
    expect((await ended).body).toEqual({ turn: null });
    const gone = new AbortController();
    const handed = turnRoute(queue, "POST", TURN_CLAIM_PATH, {}, gone.signal) as Promise<{ body: { turn: Claim } }>;
    void queue.ask("ghostpen.scorer", "v1", "p", 60_000).catch(() => {});
    gone.abort();
    expect((await handed).body.turn.prompt).toBe("p");
    expect(queue.size).toEqual({ queued: 1, claimed: 0 });
  });
});

describe("ran", () => {
  it("keeps plain names only: an unknown or odd value is null, never guessed", () => {
    expect(ranOf({ persona: "ghostpen.writer", provider: "codex", model: "has space", effort: 3 }, "x".repeat(81)))
      .toEqual({ persona: "ghostpen.writer", instructionsVersion: null, provider: "codex", model: null, effort: null, thinkingLevel: null });
  });
});

describe("the turn routes", () => {
  const start = async () => {
    const dataDir = tempDir();
    const settings = parseSettings({ instance: "host", port: 8794, dataDir, adapterKeyFile: keyFile(dataDir) });
    const turns = new TurnQueue();
    const server = createGhostpenServer({ instance: "host", dataDir, settings, adapterKey: KEY, turns });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const post = async (route: string, body: unknown, key = KEY) => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/adapter/${route}`, { method: "POST", body: JSON.stringify(body),
        headers: { authorization: `Bearer ${key.toString("base64url")}`, "content-type": "application/json" } });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    return { turns, post };
  };

  it("claims a turn and takes a 100,000-character answer, while other routes keep their 64 KiB limit", async () => {
    const { turns, post } = await start();
    const asked = turns.ask("ghostpen.writer", "writer-v2", "write the post", 60_000);
    const claimed = await post("turn/claim", {});
    expect(claimed).toMatchObject({ status: 200, body: { turn: { persona: "ghostpen.writer", instructionsVersion: "writer-v2", prompt: "write the post" } } });
    const id = (claimed.body.turn as Claim).id;
    const text = "é".repeat(100_000); // 200,000 bytes, over the other routes' 64 KiB
    expect(await post("turn/answer", { id, ok: true, text, ...CHATTER, persona: "ghostpen.writer" })).toEqual({ status: 200, body: { status: "taken" } });
    expect(await asked).toEqual({ text, ran: { persona: "ghostpen.writer", instructionsVersion: "writer-v2", provider: "claude", model: "a-model",
      effort: null, thinkingLevel: "a-level" } });
    expect((await post("thread/match", { thread: "x".repeat(70_000) })).status).toBe(413);
  });

  it("ignores an unknown or stale id with a clear status, refuses a malformed answer, and opens to the adapter key only", async () => {
    const { turns, post } = await start();
    const ended = { status: 409, body: { error: "no turn is waiting for that answer: its id is unknown, or the turn already ended" } };
    expect(await post("turn/answer", { id: "no-such-turn", ok: true, text: "x" })).toEqual(ended);
    const asked = turns.ask("ghostpen.scorer", "v1", "p", 60_000);
    const id = ((await post("turn/claim", {})).body.turn as Claim).id;
    expect((await post("turn/answer", { id })).status).toBe(400);
    expect((await post("turn/answer", { ok: true })).status).toBe(400);
    const failed = expect(asked).rejects.toThrow("turn failed: chatter refused it");
    expect(await post("turn/answer", { id, ok: false, why: "chatter refused it" })).toEqual({ status: 200, body: { status: "taken" } });
    await failed;
    expect(await post("turn/answer", { id, ok: true, text: "late" })).toEqual(ended);
    expect((await post("turn/claim", {}, Buffer.alloc(32, 9))).status).toBe(404);
  });
});
