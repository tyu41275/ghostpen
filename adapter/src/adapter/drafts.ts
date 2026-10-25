/**
 * A Write's draft in chatter (ghostpen#90). On each heartbeat, an item whose draft reached a new state gets a new card
 * in ghostpen's channel (ready, waiting, failed, stopped or published, in the service's plain words) and the previous
 * card loses its buttons. A card posted before this adapter run that still has buttons is redrawn once, re-arming
 * them after a chatter restart. Buttons: Publish (lands the post once its review approves) and Edit (asks for the
 * changes through chatter's private form). Each button names its draft's round, so an old card can't act on a new
 * draft. The service decides everything; nothing here throws into chatter.
 */
import { chipOf, chipOptions } from "../feedback/chips.js";
import { callAdapterRoute } from "./service.js";
import type { Button, PressEvent, Select, ShortlistContext } from "./shortlist.js";

export const DRAFT_PREFIX = "draft:";
const OWNER = "ghostpen.";

export interface DraftView { round: number; status: string; text: string; publish: boolean; edit: boolean;
  card?: { channelRef: string; messageRef: string; round: number; status: string } }
export interface DraftItem { index: number; draft?: DraftView }

export const draftButtons = (week: string, index: number, view: DraftView): Button[] => [
  ...(view.publish ? [{ label: "Publish", style: "success" as const, id: `${OWNER}${DRAFT_PREFIX}publish:${week}:${index}:${view.round}` }] : []),
  ...(view.edit ? [{ label: "Edit", style: "secondary" as const, id: `${OWNER}${DRAFT_PREFIX}edit:${week}:${index}:${view.round}` }] : [])];

/** A ready draft's reason choices for Publish (ADR 0101, amended 2026-10-25): one pick publishes with that reason. */
export const draftSelects = (week: string, index: number, view: DraftView): Select[] => (view.publish
  ? [{ id: `${OWNER}${DRAFT_PREFIX}reason:${week}:${index}:${view.round}`, placeholder: "Pick a reason to publish, or press Publish to type one",
    options: chipOptions(["publish"]) }] : []);

/** One heartbeat's draft cards for the week; returns how many were posted. */
export async function syncDrafts(ctx: ShortlistContext, week: string, channel: string, items: DraftItem[], redrawn: Set<string>,
  live: () => boolean = () => true): Promise<number> {
  if (!ctx.postToChannel) return 0;
  let posted = 0;
  for (const { index, draft } of items) {
    if (!live() || !draft) continue;
    const key = `draft:${week}:${index}:${draft.round}:${draft.status}`;
    const buttons = draftButtons(week, index, draft);
    const card = draft.card;
    if (card && card.round === draft.round && card.status === draft.status) {
      if (buttons.length && !redrawn.has(key) && ctx.updatePostedMessage) {
        redrawn.add(key);
        if (!await ctx.updatePostedMessage(card.channelRef, card.messageRef, { text: draft.text, selects: draftSelects(week, index, draft) }, buttons)) {
          ctx.log("warn", "ghostpen.draft.redrawFailed", { week, index });
        }
      }
      continue;
    }
    const refs = await ctx.postToChannel(channel, { text: draft.text, selects: draftSelects(week, index, draft) }, buttons);
    if (!refs?.messageRef || !refs.channelRef) throw new Error(`chatter posted nothing to ghostpen's channel ${channel}`);
    posted += 1;
    redrawn.add(key);
    await callAdapterRoute(ctx.config, "POST", "draft/posted", { week, index, round: draft.round, status: draft.status, channelRef: refs.channelRef, messageRef: refs.messageRef });
    // The card before it keeps its words for the record but loses its buttons: only the newest card acts.
    if (card && ctx.updatePostedMessage) {
      await ctx.updatePostedMessage(card.channelRef, card.messageRef, { text: "This draft moved on; the newest card about it is below.", selects: [] }, []).catch(() => false);
    }
    ctx.log("info", "ghostpen.draft.posted", { week, index, round: draft.round, status: draft.status });
  }
  return posted;
}

type Reply = { handled: true; reply_text: string } | { handled: true; ask: { title: string; label: string; placeholder: string; maxLength: number } };

/** A press of a draft card's button; any other event is left to chatter (undefined). */
export async function answerDraftPress(event: PressEvent, ctx: ShortlistContext): Promise<Reply | undefined> {
  if (event?.type !== "button_click" || typeof event.button_id !== "string") return undefined;
  const id = event.button_id.startsWith(OWNER) ? event.button_id.slice(OWNER.length) : event.button_id;
  if (!id.startsWith(DRAFT_PREFIX)) return undefined;
  const [pressed, week, index, round] = id.slice(DRAFT_PREFIX.length).split(":");
  if (!["publish", "edit", "reason"].includes(pressed ?? "") || !week || !/^\d+$/u.test(index ?? "") || !/^\d+$/u.test(round ?? "")) {
    return { handled: true, reply_text: "ghostpen does not know that button, so nothing was done." };
  }
  const chip = pressed === "reason" ? chipOf(Array.isArray(event.values) ? event.values[0] : undefined, ["publish"]) : null;
  if (pressed === "reason" && !chip) return { handled: true, reply_text: "ghostpen does not know that reason, so nothing was done." };
  const action = chip ? "publish" : pressed!;
  const typed = typeof event.text === "string" ? event.text : undefined;
  // Edit asks for the changes and Publish for its reason first; chatter sends the same press again carrying them as `text`.
  if (action === "edit" && typed === undefined) {
    return { handled: true, ask: { title: "What should change?", label: "The changes, in plain words", placeholder: "e.g. shorter intro; explain what Relay is", maxLength: 2000 } };
  }
  if (action === "publish" && !chip && typed === undefined) {
    return { handled: true, ask: { title: "Why publish it now?", label: "One line: why it is ready", placeholder: "e.g. accurate, and a friend could follow it", maxLength: 200 } };
  }
  const user = typeof event.user_id === "string" ? event.user_id : "";
  const body = { week, index: Number(index), round: Number(round), user,
    ...(action === "edit" ? { notes: typed } : { reason: chip?.reason ?? typed, ...(chip ? { chip: true } : {}) }) };
  // Publish can wait on a merge: the service answers when it is done (the adapter's route timeout covers it).
  let answered: { refused?: string; reply?: string };
  try {
    answered = await callAdapterRoute(ctx.config, "POST", `draft/${action}`, body);
  } catch (error) {
    return { handled: true, reply_text: `ghostpen could not take the press, so nothing was done: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { handled: true, reply_text: answered.refused ?? answered.reply ?? "Done." };
}
