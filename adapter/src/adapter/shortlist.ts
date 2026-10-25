/**
 * The weekly shortlist in chatter (ghostpen#89, ADR 0101 brief D13). On each heartbeat the adapter asks the service for
 * this week's shortlist and posts every card not posted yet, keeping where it went; a card posted before this adapter run
 * and not answered yet is redrawn once, which re-arms its buttons after a chatter restart. Buttons: Write, Skip (asks
 * for a one-line reason through chatter's private form) and Not yet. The service decides who may answer and keeps the
 * answer; the card is then edited to say what was chosen, without buttons. A Write's draft gets its own cards
 * (`drafts.ts`). Nothing here throws into chatter.
 */
import { syncDrafts, type DraftView } from "./drafts.js";
import { chipOf, chipOptions, type ReasonAction } from "../feedback/chips.js";
import { callAdapterRoute } from "./service.js";

export const BUTTON_OWNER = "ghostpen.";
export const BUTTON_PREFIX = "shortlist:";
/** How many cards one heartbeat posts: a shortlist is 3 to 5, so one beat posts the whole week. */
export const CARDS_PER_BEAT = 5;

export interface Button { label: string; style?: "primary" | "secondary" | "success" | "danger"; id: string }
/** A dropdown on a post (chatter #5054): its choice comes back as a press whose `values` hold the option's value. */
export interface Select { id: string; placeholder?: string; options: Array<{ label: string; value: string }> }
/** `thread`: open a thread under the post (chatter #5252); an older chatter ignores it and returns no `threadRef`. */
export interface PostContent { text: string; singleUserNotification?: { userId: string }; selects?: Select[]; thread?: { name: string } }
export interface ShortlistContext {
  config: Record<string, unknown>;
  log: (level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) => void;
  postToChannel?: (channel: string, content: PostContent, buttons?: Button[]) =>
    Promise<{ channelRef?: string; messageRef?: string; threadRef?: string } | undefined>;
  updatePostedMessage?: (channelRef: string, messageRef: string, content: PostContent, buttons?: Button[]) => Promise<boolean>;
}
export interface PressEvent { type?: unknown; button_id?: unknown; user_id?: unknown; text?: unknown; values?: unknown; channel_id?: unknown; is_thread?: unknown }
interface Item { index: number; id: string; text: string; posted?: { channelRef: string; messageRef: string }; answered: boolean; draft?: DraftView }
interface Week { week?: string; channel?: string; operator?: string; items?: Item[]; off?: string; waiting?: string }

const SHORTLIST_ACTIONS: readonly ReasonAction[] = ["write", "skip", "later"];
/** The card's reason choices (ADR 0101, amended 2026-10-25): one pick answers the card with that reason. */
const reasons = (week: string, index: number): Select[] => [{ id: `${BUTTON_OWNER}${BUTTON_PREFIX}reason:${week}:${index}`,
  placeholder: "Pick a reason, or press a button to type your own", options: chipOptions(SHORTLIST_ACTIONS) }];
const ASK: Record<string, { title: string; label: string; placeholder: string }> = {
  write: { title: "Why write this one?", label: "One line: what makes it worth a post", placeholder: "e.g. people keep asking how this works" },
  skip: { title: "Why skip this topic?", label: "One line: what makes it not worth a post", placeholder: "e.g. too narrow, already covered" },
  later: { title: "Why not yet?", label: "One line: what it is waiting for", placeholder: "e.g. the outcome is not known yet" } };

/** The card's thread name: its first line without markdown, at most 100 characters (Discord's limit). */
export const threadName = (text: string) => {
  const line = text.split("\n")[0]!.replace(/\*\*/gu, "").replace(/^#\d+\s+/u, "").trim();
  return (line.length > 100 ? `${line.slice(0, 99)}…` : line) || "This topic";
};

const buttons = (week: string, index: number): Button[] => [
  { label: "Write", style: "success", id: `${BUTTON_OWNER}${BUTTON_PREFIX}write:${week}:${index}` },
  { label: "Skip", style: "secondary", id: `${BUTTON_OWNER}${BUTTON_PREFIX}skip:${week}:${index}` },
  { label: "Not yet", style: "secondary", id: `${BUTTON_OWNER}${BUTTON_PREFIX}later:${week}:${index}` }];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One heartbeat: post this week's unposted cards and redraw, once per adapter run, the posted ones not yet answered. */
export async function syncShortlist(ctx: ShortlistContext, redrawn: Set<string>, live: () => boolean = () => true): Promise<"off" | number> {
  if (!ctx.postToChannel) return "off";
  const state = await callAdapterRoute<Week>(ctx.config, "GET", "shortlist");
  if (!state.week || !state.channel || !state.items) return "off";
  let posted = 0;
  for (const item of state.items) {
    if (!live() || item.answered) continue;
    const key = `${state.week}:${item.index}`;
    if (item.posted) {
      if (redrawn.has(key) || !ctx.updatePostedMessage) continue;
      redrawn.add(key);
      if (!await ctx.updatePostedMessage(item.posted.channelRef, item.posted.messageRef, { text: item.text, selects: reasons(state.week, item.index) }, buttons(state.week, item.index))) {
        ctx.log("warn", "ghostpen.shortlist.redrawFailed", { week: state.week, index: item.index });
      }
      continue;
    }
    if (posted >= CARDS_PER_BEAT) continue;
    // The week's first card pings the operator once; the rest arrive quietly under it.
    const ping = item.index === 0 && state.operator ? { singleUserNotification: { userId: state.operator } } : {};
    // Each card opens its thread (ADR 0101, amended 2026-10-25): where the operator asks about the topic or adds context.
    const refs = await ctx.postToChannel(state.channel, { text: item.text, ...ping, selects: reasons(state.week, item.index), thread: { name: threadName(item.text) } },
      buttons(state.week, item.index));
    if (!refs?.messageRef || !refs.channelRef) throw new Error(`chatter posted nothing to ghostpen's channel ${state.channel}`);
    posted += 1;
    redrawn.add(key);
    await callAdapterRoute(ctx.config, "POST", "shortlist/posted", { week: state.week, index: item.index, channelRef: refs.channelRef, messageRef: refs.messageRef,
      ...(refs.threadRef ? { threadRef: refs.threadRef } : {}) });
    ctx.log("info", "ghostpen.shortlist.posted", { week: state.week, index: item.index, id: item.id });
  }
  // Then each Write's draft card (ghostpen#90), under the cards it came from.
  return posted + await syncDrafts(ctx, state.week, state.channel, state.items, redrawn, live);
}

type Reply = { handled: true; reply_text: string } | { handled: true; ask: { title: string; label: string; placeholder: string; maxLength: number } };

/** A press of a shortlist card's button; any other event is left to chatter (undefined). */
export async function answerShortlistPress(event: PressEvent, ctx: ShortlistContext): Promise<Reply | undefined> {
  if (event?.type !== "button_click" || typeof event.button_id !== "string") return undefined;
  const id = event.button_id.startsWith(BUTTON_OWNER) ? event.button_id.slice(BUTTON_OWNER.length) : event.button_id;
  if (!id.startsWith(BUTTON_PREFIX)) return undefined;
  const [pressed, week, index] = id.slice(BUTTON_PREFIX.length).split(":");
  if (!["write", "skip", "later", "reason"].includes(pressed ?? "") || !week || !/^\d+$/u.test(index ?? "")) {
    return { handled: true, reply_text: "ghostpen does not know that button, so nothing was done." };
  }
  // A pick from the card's reasons answers with that press and those words.
  const chip = pressed === "reason" ? chipOf(Array.isArray(event.values) ? event.values[0] : undefined, SHORTLIST_ACTIONS) : null;
  if (pressed === "reason" && !chip) return { handled: true, reply_text: "ghostpen does not know that reason, so nothing was done." };
  const action = chip?.action ?? pressed!;
  const reason = chip?.reason ?? (typeof event.text === "string" ? event.text : undefined);
  // A button asks for its reason first; chatter sends the same press again carrying it as `text`.
  if (reason === undefined) return { handled: true, ask: { ...ASK[action]!, maxLength: 200 } };
  let answered: { refused?: string; text?: string; reply?: string; already?: boolean; posted?: { channelRef: string; messageRef: string } | null };
  try {
    answered = await callAdapterRoute(ctx.config, "POST", "shortlist/answer", { week, index: Number(index), action, user: typeof event.user_id === "string" ? event.user_id : "",
      reason, ...(chip ? { chip: true } : {}) });
  } catch (error) {
    return { handled: true, reply_text: `ghostpen could not take the answer, so nothing was done: ${errorText(error)}` };
  }
  if (answered.refused) return { handled: true, reply_text: answered.refused };
  // The answer is kept whether or not the edit lands; a card left with buttons answers its next press the same way.
  const edited = answered.posted && answered.text && ctx.updatePostedMessage
    ? await ctx.updatePostedMessage(answered.posted.channelRef, answered.posted.messageRef, { text: answered.text, selects: [] }, []).catch(() => false) : false;
  if (!edited) ctx.log("warn", "ghostpen.shortlist.editFailed", { week, index });
  return { handled: true, reply_text: answered.reply ?? (answered.already ? "This topic was answered already; its card shows the answer." : "Done.") };
}
