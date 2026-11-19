import { describe, expect, it, vi } from "vitest";
import { MAX_RUNNING, RETRY_MS, startTurns, type CapabilityAnswer, type CapabilityRequest, type TurnsContext } from "../src/adapter/turns.js";

type Body = Record<string, unknown>;

/** ghostpen's service as the pump sees it: claims hand out `queued` turns, then wait until `give` or `end`; answers are kept. */
function fakeService(queued: Body[] = []) {
  const answers: Body[] = [], waiting: Array<(value: Body) => void> = [], claims: number[] = [];
  let failures = 0;
  const call = async (route: string, body: Body): Promise<Body> => {
    if (route !== "turn/claim") { answers.push(body); return { status: "taken" }; }
    claims.push(1);
    if (failures > 0) { failures -= 1; throw new Error("ghostpen's service did not answer within 35 s"); }
    const turn = queued.shift();
    return turn ? { turn } : new Promise((resolve) => { waiting.push(resolve); });
  };
  const wait = vi.fn(async () => {});
  return { transport: { call, wait }, answers, claims, wait,
    failNext: (count: number) => { failures = count; },
    give: (turn: Body) => waiting.shift()!({ turn }),
    end: () => { for (const resolve of waiting.splice(0)) resolve({ turn: null }); } };
}

const turn = (id: string, over: Body = {}): Body => ({ id, persona: "ghostpen.scorer", instructionsVersion: "scorer-v1", prompt: `prompt ${id}`, timeoutMs: 60_000, ...over });
const answered = (persona: string): CapabilityAnswer => ({ ok: true, text: "the answer", persona, provider: "claude", model: "a-model", effort: null, thinkingLevel: null });
const byId = (answers: Body[]) => [...answers].sort((a, b) => String(a.id).localeCompare(String(b.id)));
/** Lets every pending promise settle: a few turns of the event loop, no timer. */
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => { setImmediate(resolve); }); };

function context(runCapability?: TurnsContext["runCapability"]) {
  const log = vi.fn();
  return { ctx: { config: {}, log, ...(runCapability ? { runCapability } : {}) } as TurnsContext, log };
}

describe("the adapter's turn pump", () => {
  it("runs each claimed turn on its persona with its instructions version, and posts chatter's answer back", async () => {
    const run = vi.fn(async (persona: string, _request: CapabilityRequest) => answered(persona));
    const service = fakeService([turn("1"), turn("2", { persona: "ghostpen.thread-answer", instructionsVersion: "x".repeat(129) })]);
    let live = true;
    expect(startTurns(context(run).ctx, () => live, service.transport)).toBe(true);
    await settle();
    expect(run.mock.calls).toEqual([
      ["ghostpen.scorer", { prompt: "prompt 1", timeoutMs: 60_000, instructionsVersion: "scorer-v1" }],
      // A version chatter would refuse is left out, never sent.
      ["ghostpen.thread-answer", { prompt: "prompt 2", timeoutMs: 60_000 }]]);
    expect(byId(service.answers)).toEqual([{ id: "1", ...answered("ghostpen.scorer") }, { id: "2", ...answered("ghostpen.thread-answer") }]);
    live = false;
    service.end();
  });

  it("runs at most two turns at once", async () => {
    const finish: Array<() => void> = [];
    const run = vi.fn((persona: string) => new Promise<CapabilityAnswer>((resolve) => { finish.push(() => resolve(answered(persona))); }));
    const service = fakeService([turn("1"), turn("2"), turn("3")]);
    let live = true;
    startTurns(context(run).ctx, () => live, service.transport);
    await settle();
    expect(MAX_RUNNING).toBe(2);
    expect(run).toHaveBeenCalledTimes(2);
    finish.shift()!();
    await settle();
    expect(run).toHaveBeenCalledTimes(3);
    live = false;
    for (const done of finish.splice(0)) done();
    await settle();
    service.end();
  });

  it("refuses a persona that is not ghostpen's without running it", async () => {
    const run = vi.fn(async (persona: string) => answered(persona));
    const service = fakeService([turn("1", { persona: "tempo.advice-words" }), turn("2", { persona: "ghostpen.writer x" })]);
    let live = true;
    startTurns(context(run).ctx, () => live, service.transport);
    await settle();
    expect(run).not.toHaveBeenCalled();
    const why = "ghostpen's adapter runs only ghostpen.scorer, ghostpen.writer, ghostpen.thread-answer turns, not";
    expect(byId(service.answers)).toEqual([{ id: "1", ok: false, why: `${why} tempo.advice-words` }, { id: "2", ok: false, why: `${why} that persona` }]);
    live = false;
    service.end();
  });

  it("posts a throw or chatter's {ok: false} as the turn's failure reason, and never throws itself", async () => {
    const run = vi.fn(async (_persona: string, request: CapabilityRequest): Promise<CapabilityAnswer> => {
      if (request.prompt === "prompt 1") throw new Error("boom");
      return { ok: false, reason: "the account's usage limit", persona: "ghostpen.scorer" };
    });
    const service = fakeService([turn("1"), turn("2")]);
    let live = true;
    const { ctx } = context(run);
    ctx.log = () => { throw new Error("a broken log"); };
    startTurns(ctx, () => live, service.transport);
    await settle();
    expect(byId(service.answers)).toEqual([{ id: "1", ok: false, why: "runCapability threw: boom" }, { id: "2", ok: false, why: "the account's usage limit" }]);
    live = false;
    service.end();
  });

  it("waits after a failed claim and says so once per reason", async () => {
    const service = fakeService();
    service.failNext(4);
    const { ctx, log } = context(vi.fn(async (persona: string) => answered(persona)));
    let live = true;
    startTurns(ctx, () => live, service.transport);
    await settle();
    expect(service.wait).toHaveBeenCalledTimes(4);
    expect(service.wait).toHaveBeenCalledWith(RETRY_MS);
    expect(log.mock.calls.filter(([, event]) => event === "ghostpen.turns.claim_failed")).toHaveLength(2); // one per runner
    live = false;
    service.end();
  });

  it("runs nothing once the adapter stopped: a turn claimed as it stopped is put back, and no claim follows", async () => {
    const run = vi.fn(async (persona: string) => answered(persona));
    const service = fakeService();
    let live = true;
    startTurns(context(run).ctx, () => live, service.transport);
    await settle();
    expect(service.claims).toHaveLength(2);
    live = false;
    service.give(turn("1"));
    service.end();
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(service.answers).toEqual([{ id: "1", release: true }]);
    expect(service.claims).toHaveLength(2);
  });

  it("starts nothing in a chatter without ctx.runCapability", async () => {
    const service = fakeService([turn("1")]);
    const { ctx, log } = context();
    expect(startTurns(ctx, () => true, service.transport)).toBe(false);
    await settle();
    expect(service.claims).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("info", "ghostpen.turns.off", { why: "this chatter has no ctx.runCapability, so ghostpen's model turns are not run" });
  });
});
