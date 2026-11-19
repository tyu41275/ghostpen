/**
 * The routes the adapter in chatter runs ghostpen's model turns through (ghostpen#146, `turns/queue.ts`), behind the adapter
 * key like every `/v1/adapter/` route:
 *
 *   POST /v1/adapter/turn/claim    {}: the next turn `{turn: {id, persona, instructionsVersion, prompt, timeoutMs}}`, waiting
 *                                  up to 25 s for one (`{turn: null}` then); a claim whose request went away puts its turn back
 *   POST /v1/adapter/turn/answer   {id, ok, text?, why?, release?, …chatter's answer fields}: ends the turn with ctx.runCapability's
 *                                  answer, or with why it failed; `release: true` puts it back unrun. Its body may hold the
 *                                  longest answer at its worst JSON escape (6 bytes a character), the other routes' 64 KiB
 *                                  being too small for a 100,000-character answer.
 *
 * An answer for an id no claimed turn has (unknown, or the turn already ended) is ignored: 409, saying so.
 */
import { MAX_ANSWER_TEXT, type TurnQueue } from "../turns/queue.js";
import type { Reply } from "./adapter-routes.js";

export const TURN_CLAIM_PATH = "/v1/adapter/turn/claim";
export const TURN_ANSWER_PATH = "/v1/adapter/turn/answer";
/** How long a claim waits for a turn before answering none: the adapter asks again at once. */
export const CLAIM_WAIT_MS = 25_000;
/**
 * The answer route's body limit: the longest answer chatter gives (`MAX_ANSWER_TEXT` characters) at JSON's widest escape,
 * `\u0001` being 6 bytes for one character, plus 64 KiB for the answer's other fields; never less than a valid answer needs.
 */
export const MAX_TURN_ANSWER_BODY = MAX_ANSWER_TEXT * 6 + 64 * 1024;

const ENDED: Reply = { status: 409, body: { error: "no turn is waiting for that answer: its id is unknown, or the turn already ended" } };

/** One turn route; null when `path` is not one. `gone` aborts when the claim's request went away before its answer. */
export function turnRoute(turns: TurnQueue, method: string, path: string, body: Record<string, unknown>, gone?: AbortSignal):
  Promise<Reply> | Reply | null {
  if (path !== TURN_CLAIM_PATH && path !== TURN_ANSWER_PATH) return null;
  if (method !== "POST") return { status: 405, body: { error: "use POST" } };
  if (path === TURN_CLAIM_PATH) {
    const { next, cancel } = turns.claim(CLAIM_WAIT_MS);
    gone?.addEventListener("abort", cancel, { once: true });
    return next.then((turn) => {
      gone?.removeEventListener("abort", cancel);
      // Handed to a request that went away as it came: nobody will run it, so it goes back for the next claim.
      if (turn && gone?.aborted) turns.release(turn.id);
      return { status: 200, body: { turn } };
    });
  }
  if (typeof body.id !== "string" || !body.id) return { status: 400, body: { error: "send the id the claim gave" } };
  if (body.release === true) return turns.release(body.id) ? { status: 200, body: { status: "released" } } : ENDED;
  if (typeof body.ok !== "boolean") return { status: 400, body: { error: "send ok: true with text, or ok: false with why" } };
  return turns.answer(body.id, body) ? { status: 200, body: { status: "taken" } } : ENDED;
}
