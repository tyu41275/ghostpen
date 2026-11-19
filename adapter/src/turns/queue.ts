/**
 * ghostpen's model turns, queued in its service (ghostpen#146). The service has no chatter `ctx`, so it cannot run a model
 * itself: it asks here, and the adapter in chatter claims each turn (`POST /v1/adapter/turn/claim`), runs it with
 * `ctx.runCapability` on the turn's persona, and posts the answer back (`POST /v1/adapter/turn/answer`, `service/turn-routes.ts`).
 *
 * - A thread answer goes ahead of every other queued turn: the operator is waiting on it. Otherwise first asked, first claimed,
 *   so the turns of one job keep their order.
 * - A turn nobody claims within its `timeoutMs` rejects, as does a claimed one with no answer within `timeoutMs` and a minute.
 * - A request chatter would refuse (chatter docs/adapter-capability-run.md: a prompt over 400,000 characters, a timeout
 *   outside 1 s to 30 minutes, an instructions version that is not 1 to 128 characters) is refused here at once.
 * Every rejection says why in plain words. In memory only: a restarted service starts with none.
 */
import { randomUUID } from "node:crypto";
import { ranOf, type Ran } from "./ran.js";

export const TURN_PERSONAS = ["ghostpen.scorer", "ghostpen.writer", "ghostpen.thread-answer"] as const;
export type TurnPersona = (typeof TURN_PERSONAS)[number];
/** The persona whose turns go first. */
export const FIRST_PERSONA: TurnPersona = "ghostpen.thread-answer";
export const MAX_PROMPT = 400_000;
export const MAX_ANSWER_TEXT = 100_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30 * 60_000;
export const MAX_INSTRUCTIONS_VERSION = 128;
/** How long after a claimed turn's own timeout its answer may still come: the post back from chatter. */
export const ANSWER_GRACE_MS = 60_000;

/** What a claim hands the adapter. */
export interface Claim { id: string; persona: TurnPersona; instructionsVersion: string; prompt: string; timeoutMs: number }
export interface TurnResult { text: string; ran: Ran }
/** The adapter's answer: chatter's answer fields (`persona`, `provider`, `model`, …) beside `ok` and `text`, or why it failed. */
export type TurnAnswer = { ok?: unknown; text?: unknown; why?: unknown } & Record<string, unknown>;

interface Turn extends Claim {
  claimBy: number; resolve: (result: TurnResult) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout>;
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
const later = (ms: number, fn: () => void) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; };

/** Why chatter would refuse this turn, or null. */
function refusal(persona: string, instructionsVersion: string, prompt: string, timeoutMs: number): string | null {
  if (!(TURN_PERSONAS as readonly string[]).includes(persona)) return `ghostpen has no ${persona} turns (only ${TURN_PERSONAS.join(", ")})`;
  if (typeof instructionsVersion !== "string" || instructionsVersion.length < 1 || instructionsVersion.length > MAX_INSTRUCTIONS_VERSION) {
    return `the ${persona} turn's instructions version must be 1 to ${MAX_INSTRUCTIONS_VERSION} characters`;
  }
  if (typeof prompt !== "string" || !prompt) return `the ${persona} turn has no prompt`;
  if (prompt.length > MAX_PROMPT) return `the ${persona} turn's prompt is ${prompt.length} characters, over chatter's ${MAX_PROMPT}`;
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return `the ${persona} turn's time must be 1 s to 30 minutes`;
  }
  return null;
}

export class TurnQueue {
  private readonly queued: Turn[] = [];
  private readonly claimed = new Map<string, Turn>();
  private readonly waiters: Array<(claim: Claim) => void> = [];

  /** Queues one turn; resolves its answer's text and what it ran on, or rejects saying why there is none. */
  ask(persona: TurnPersona, instructionsVersion: string, prompt: string, timeoutMs: number): Promise<TurnResult> {
    const refused = refusal(persona, instructionsVersion, prompt, timeoutMs);
    if (refused) return Promise.reject(new Error(`ghostpen did not ask for a model turn: ${refused}`));
    return new Promise<TurnResult>((resolve, reject) => {
      const turn: Turn = { id: randomUUID(), persona, instructionsVersion, prompt, timeoutMs, claimBy: Date.now() + timeoutMs, resolve, reject };
      const waiter = this.waiters.shift();
      if (waiter) waiter(this.take(turn));
      else this.enqueue(turn, false);
    });
  }

  /** The next turn, waiting up to `waitMs` for one (null then); `cancel` stops the wait (a claim that went away). */
  claim(waitMs: number): { next: Promise<Claim | null>; cancel: () => void } {
    const turn = this.queued.shift();
    if (turn) return { next: Promise.resolve(this.take(turn)), cancel: () => {} };
    let done!: (claim: Claim | null) => void;
    const next = new Promise<Claim | null>((resolve) => { done = resolve; });
    const waiter = (claim: Claim) => { clearTimeout(timer); done(claim); };
    const cancel = () => {
      const at = this.waiters.indexOf(waiter);
      if (at < 0) return; // already handed a turn or ended
      this.waiters.splice(at, 1);
      clearTimeout(timer);
      done(null);
    };
    const timer = later(waitMs, cancel);
    this.waiters.push(waiter);
    return { next, cancel };
  }

  /** Ends a claimed turn with the adapter's answer; false when no claimed turn has that id (unknown, or it already ended). */
  answer(id: string, answer: TurnAnswer): boolean {
    const turn = this.claimed.get(id);
    if (!turn) return false;
    this.claimed.delete(id);
    clearTimeout(turn.timer);
    const fail = (why: string) => turn.reject(new Error(`ghostpen's ${turn.persona} turn failed: ${why}`));
    if (answer.ok !== true) {
      fail(typeof answer.why === "string" && answer.why.trim() ? answer.why.trim().split("\n")[0]!.slice(0, 300) : "no reason given");
    } else if (typeof answer.text !== "string" || !answer.text.trim()) fail("the answer was empty");
    else if (answer.text.length > MAX_ANSWER_TEXT) fail(`the answer was ${answer.text.length} characters, over ${MAX_ANSWER_TEXT}`);
    else turn.resolve({ text: answer.text, ran: ranOf(answer, turn.instructionsVersion) });
    return true;
  }

  /** Puts a claimed turn back at the head of its place (its claim went to an adapter that stopped); false when none has that id. */
  release(id: string): boolean {
    const turn = this.claimed.get(id);
    if (!turn) return false;
    this.claimed.delete(id);
    clearTimeout(turn.timer);
    const waiter = this.waiters.shift();
    if (waiter) waiter(this.take(turn));
    else this.enqueue(turn, true);
    return true;
  }

  /** How many turns wait for a claim and how many are claimed. */
  get size(): { queued: number; claimed: number } { return { queued: this.queued.length, claimed: this.claimed.size }; }

  private enqueue(turn: Turn, head: boolean): void {
    const first = turn.persona === FIRST_PERSONA;
    // A thread answer goes after the thread answers already queued (before them when put back); any other after everything
    // (or before the others when put back), so order within a kind is kept.
    const at = head ? this.queued.findIndex((one) => first || one.persona !== FIRST_PERSONA)
      : first ? this.queued.findIndex((one) => one.persona !== FIRST_PERSONA) : -1;
    this.queued.splice(at < 0 ? this.queued.length : at, 0, turn);
    turn.timer = later(Math.max(0, turn.claimBy - Date.now()), () => {
      const index = this.queued.indexOf(turn);
      if (index >= 0) this.queued.splice(index, 1);
      turn.reject(new Error(`nobody took ghostpen's ${turn.persona} turn within ${seconds(turn.timeoutMs)}: ghostpen's adapter in chatter `
        + "claims its turns, so it is off, or this chatter does not run model turns for adapters"));
    });
  }

  private take(turn: Turn): Claim {
    clearTimeout(turn.timer);
    this.claimed.set(turn.id, turn);
    turn.timer = later(turn.timeoutMs + ANSWER_GRACE_MS, () => {
      if (!this.claimed.delete(turn.id)) return;
      turn.reject(new Error(`ghostpen's adapter took the ${turn.persona} turn but no answer came back within ${seconds(turn.timeoutMs + ANSWER_GRACE_MS)}`));
    });
    return { id: turn.id, persona: turn.persona, instructionsVersion: turn.instructionsVersion, prompt: turn.prompt, timeoutMs: turn.timeoutMs };
  }
}

/** What a job needs of the queue: asking (a test passes a fake). */
export type TurnAsker = Pick<TurnQueue, "ask">;
