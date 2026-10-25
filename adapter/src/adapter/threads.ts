/**
 * Messages in a card's thread (ADR 0101, amended 2026-10-25). chatter hands every message to its adapters before its
 * own routing; a message in a thread that is a ghostpen card's (the one ghostpen opened, or one the operator opened on
 * the card) is ghostpen's: chatter is told it is handled at once, and the answer, which can take a model a minute,
 * is posted into the thread when it comes. Any other message is left to chatter.
 */
import { callAdapterRoute } from "./service.js";
import type { PressEvent, ShortlistContext } from "./shortlist.js";

/** How long an answer may take: the answering command's own limit is the operator's setting, at most an hour. */
export const ANSWER_TIMEOUT_MS = 60 * 60 * 1000;

export async function answerThreadMessage(event: PressEvent, ctx: ShortlistContext): Promise<{ handled: true } | undefined> {
  if (event?.type !== "message" || event.is_thread !== true || typeof event.channel_id !== "string" || !ctx.postToChannel) return undefined;
  const thread = event.channel_id;
  let ours = false;
  try {
    ours = (await callAdapterRoute<{ ours?: boolean }>(ctx.config, "POST", "thread/match", { thread })).ours === true;
  } catch (error) {
    ctx.log("warn", "ghostpen.thread.matchFailed", { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
  if (!ours) return undefined;
  const post = ctx.postToChannel;
  void (async () => {
    let reply: string;
    try {
      reply = (await callAdapterRoute<{ reply?: string }>(ctx.config, "POST", "thread/message",
        { thread, user: typeof event.user_id === "string" ? event.user_id : "", text: typeof event.text === "string" ? event.text : "" }, ANSWER_TIMEOUT_MS)).reply
        ?? "ghostpen answered nothing.";
    } catch (error) {
      reply = `ghostpen could not take that message: ${error instanceof Error ? error.message : String(error)}`;
    }
    await post(thread, { text: reply }).catch((error: unknown) => ctx.log("warn", "ghostpen.thread.replyFailed", { error: String(error) }));
  })();
  return { handled: true };
}
