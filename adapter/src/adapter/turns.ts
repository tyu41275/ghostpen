/**
 * ghostpen's model turns on chatter's side (ghostpen#146): ghostpen's service queues each turn (`turns/queue.ts`); this pump
 * claims it (`POST /v1/adapter/turn/claim`, a long poll), runs it once with `ctx.runCapability` on its persona, so chatter's
 * settings pick the model, thinking level and account, and posts the answer back (`POST /v1/adapter/turn/answer`).
 *
 * - Only ghostpen's own personas run: `ghostpen.scorer`, `ghostpen.writer`, `ghostpen.thread-answer`; any other is
 *   answered as refused, never run.
 * - At most `MAX_RUNNING` turns at once: one claim at a time per runner.
 * - Off in a chatter without `ctx.runCapability`: nothing is claimed, and the service's turns end unclaimed, saying so.
 * - A throw or `{ok: false}` from chatter is posted as the turn's failure reason.
 * - Once the adapter stops (`live()` false), it claims nothing more; a turn claimed as it stopped is put back unrun.
 *   A turn already running still posts its answer.
 * Nothing here throws into chatter.
 */
import { CLAIM_WAIT_MS } from "../service/turn-routes.js";
import { MAX_INSTRUCTIONS_VERSION, TURN_PERSONAS } from "../turns/queue.js";
import { plainName } from "../turns/ran.js";
import { callAdapterRoute } from "./service.js";

/** ctx.runCapability's request (chatter docs/adapter-capability-run.md); chatter refuses an `instructionsVersion` not 1 to 128 characters. */
export interface CapabilityRequest { prompt: string; timeoutMs?: number; instructionsVersion?: string }
/** ctx.runCapability's answer (chatter docs/adapter-capability-run.md). */
export type CapabilityAnswer = { ok: true; text: string; persona: string; provider: string; model: string; effort?: string | null;
  thinkingLevel?: string | null; executionEffort?: string | null; account?: string | null }
  | { ok: false; reason: string; persona?: string };

export interface TurnsContext {
  config: Record<string, unknown>;
  log: (level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) => void;
  runCapability?: (capability: string, request: CapabilityRequest) => Promise<CapabilityAnswer>;
}

/** How the pump reaches the service (an adapter route, POST) and waits after a failed claim; a test's fakes otherwise. */
export interface TurnsTransport {
  call: (route: string, body: Record<string, unknown>, timeoutMs?: number, maxAnswer?: number) => Promise<Record<string, unknown>>;
  wait: (ms: number) => Promise<void>;
}

export const MAX_RUNNING = 2;
/** The wait after a claim that failed (the service down or too old to queue turns) before the next. */
export const RETRY_MS = 60_000;
/** A claim's request outlives the service's long poll. */
const CLAIM_TIMEOUT_MS = CLAIM_WAIT_MS + 10_000;
/** A claim carries a prompt of up to 400,000 characters, JSON-escaped. */
const MAX_CLAIM_ANSWER = 4 * 1024 * 1024;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A claim's `instructionsVersion` when it is a string of 1 to 128 characters, else undefined (Tempo's rule): the turn
 * then runs without one rather than being refused. Never throws.
 */
export function instructionsVersionOf(claimed: unknown): string | undefined {
  try {
    const version = typeof claimed === "object" && claimed !== null ? (claimed as { instructionsVersion?: unknown }).instructionsVersion : undefined;
    return typeof version === "string" && version.length >= 1 && version.length <= MAX_INSTRUCTIONS_VERSION ? version : undefined;
  } catch {
    return undefined; // a getter that throws: no version, never a failed turn
  }
}

function log(ctx: TurnsContext, level: "info" | "warn", event: string, data: Record<string, unknown>): void {
  try { ctx.log(level, event, data); } catch { /* a log that throws must not stop the pump */ }
}

/** Runs one claimed turn and returns the answer to post: chatter's answer, or why there is none. */
async function run(ctx: TurnsContext, turn: Record<string, unknown>): Promise<Record<string, unknown>> {
  const persona = turn.persona;
  if (typeof persona !== "string" || !(TURN_PERSONAS as readonly string[]).includes(persona)) {
    return { ok: false, why: `ghostpen's adapter runs only ${TURN_PERSONAS.join(", ")} turns, not ${plainName(persona) ?? "that persona"}` };
  }
  if (typeof turn.prompt !== "string" || !turn.prompt) return { ok: false, why: "the turn came with no prompt" };
  const instructionsVersion = instructionsVersionOf(turn);
  let answer: CapabilityAnswer;
  try {
    answer = await ctx.runCapability!(persona, { prompt: turn.prompt, ...(typeof turn.timeoutMs === "number" ? { timeoutMs: turn.timeoutMs } : {}),
      ...(instructionsVersion === undefined ? {} : { instructionsVersion }) });
  } catch (error) {
    return { ok: false, why: `runCapability threw: ${errorText(error)}` }; // chatter's contract says it never throws
  }
  if (answer?.ok === true) return { ...answer };
  const reason = (answer as { reason?: unknown } | undefined)?.reason;
  return { ok: false, why: typeof reason === "string" && reason ? reason : "chatter gave no reason" };
}

/** One runner: claims a turn, runs it, posts its answer, until the adapter stops. */
async function runner(ctx: TurnsContext, live: () => boolean, transport: TurnsTransport): Promise<void> {
  let lastError = "";
  while (live()) {
    let claimed: Record<string, unknown>;
    try {
      claimed = await transport.call("turn/claim", {}, CLAIM_TIMEOUT_MS, MAX_CLAIM_ANSWER);
      lastError = "";
    } catch (error) {
      // Said once per new reason, not on every retry of a service that stays down.
      if (errorText(error) !== lastError) log(ctx, "warn", "ghostpen.turns.claim_failed", { error: errorText(error) });
      lastError = errorText(error);
      await transport.wait(RETRY_MS);
      continue;
    }
    const turn = claimed?.turn as Record<string, unknown> | null | undefined;
    if (!turn || typeof turn !== "object" || typeof turn.id !== "string") continue;
    const id = turn.id;
    if (!live()) {
      await transport.call("turn/answer", { id, release: true }).catch(() => { /* the service ends it when its time runs out */ });
      return;
    }
    const answer = await run(ctx, turn);
    try {
      await transport.call("turn/answer", { ...answer, id });
      log(ctx, answer.ok === true ? "info" : "warn", "ghostpen.turns.answered", { id, persona: plainName(turn.persona), ok: answer.ok === true });
    } catch (error) {
      log(ctx, "warn", "ghostpen.turns.answer_failed", { id, error: errorText(error) });
    }
  }
}

/** Starts the pump's runners (not awaited); false, with nothing started, when this chatter has no `ctx.runCapability`. */
export function startTurns(ctx: TurnsContext, live: () => boolean, transport?: TurnsTransport): boolean {
  if (typeof ctx.runCapability !== "function") {
    log(ctx, "info", "ghostpen.turns.off", { why: "this chatter has no ctx.runCapability, so ghostpen's model turns are not run" });
    return false;
  }
  const via: TurnsTransport = transport ?? {
    call: (route, body, timeoutMs, maxAnswer) => callAdapterRoute(ctx.config, "POST", route, body, timeoutMs, maxAnswer),
    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); }),
  };
  for (let i = 0; i < MAX_RUNNING; i += 1) {
    void runner(ctx, live, via).catch((error: unknown) => log(ctx, "warn", "ghostpen.turns.stopped", { error: errorText(error) }));
  }
  return true;
}
