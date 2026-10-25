/**
 * The draft routes the chatter adapter calls (ghostpen#90), behind the same adapter key as the shortlist's:
 *
 *   POST /v1/adapter/draft/posted   {week, index, round, status, channelRef, messageRef}: a draft card was posted
 *   POST /v1/adapter/draft/publish  {week, index, round, user, reason, chip?}: Publish with its reason, the operator's only;
 *                                   lands the post once it is ready
 *   POST /v1/adapter/draft/edit     {week, index, round, user, notes}: Edit, the operator's only; the writer makes the changes
 *
 * `round` is the card's: a press on a card for an older draft is refused, so it can never publish or edit a newer one.
 *
 * `draftCard` is the card text the shortlist route hands the adapter with each item's draft.
 */
import { checkPost, mergePost, type PublishSettings } from "../publish/github.js";
import { addFeedback } from "../feedback/store.js";
import type { DraftJobs } from "../publish/jobs.js";
import type { GhostpenSettings } from "../settings.js";
import { findItem, readShortlists, saveShortlists, type DraftState } from "../shortlist/state.js";
import type { Reply } from "./adapter-routes.js";

const MAX_CARD = 1900;
const OPERATOR_ONLY = "Only the operator can publish or edit ghostpen's drafts, so nothing was done.";
const OLD_CARD = "This card is for an older draft; use the newest card. Nothing was done.";
/** A press must name its card's round, and it must be the draft's: a missing round counts as an old card. */
const stale = (draft: DraftState, body: Record<string, unknown>) => body.round !== draft.round;

/** The draft's card in plain words, or null while it is being written; and which buttons it gets. */
export function draftCard(draft: DraftState, topic: string): { text: string; publish: boolean; edit: boolean } | null {
  const title = draft.title ?? topic;
  const report = draft.report ? `\n\n${draft.report}` : "";
  const clip = (text: string) => (text.length > MAX_CARD ? `${text.slice(0, MAX_CARD)}…` : text);
  switch (draft.status) {
    case "queued": case "drafting": return null;
    case "ready": return draft.pr
      ? { text: clip(`**Draft ready: ${title}**${draft.problem ? `\nLast try: ${draft.problem}` : ""}\nPull request: ${draft.pr.url}${draft.pr.preview ? `\nPreview: ${draft.pr.preview}` : ""}${report}\n\nPublish puts it on the blog once the independent review approves. Edit sends your changes to the writer.`), publish: true, edit: true }
      : { text: clip(`**Draft ready: ${title}**\nIt is kept in ghostpen: no blog repo is set (settings.publish).${report}`), publish: false, edit: true };
    case "held": return { text: clip(`**Draft waiting: ${title}**${report}\n\nIts background post comes first.`), publish: false, edit: false };
    case "failed": return { text: clip(`**Draft failed its checks: ${title}**${report}\n\nEdit to tell the writer what to change.`), publish: false, edit: true };
    case "error": return { text: clip(`**Drafting stopped: ${title}**\n${draft.problem ?? "no reason was kept"}${report}\n\nEdit to try again.`), publish: false, edit: true };
    case "publishing": return { text: clip(`**Publishing: ${title}**${draft.pr ? `\n${draft.pr.url}` : ""}`), publish: false, edit: false };
    case "published": return { text: clip(`**Published: ${title}**${draft.pr ? `\n${draft.pr.url}` : ""}`), publish: false, edit: false };
  }
}

export function draftPosted(settings: GhostpenSettings, body: Record<string, unknown>): Reply {
  const state = readShortlists(settings.dataDir);
  const item = findItem(state, body.week, body.index);
  if (!item?.draft) return { status: 404, body: { error: "no such draft" } };
  if (typeof body.channelRef !== "string" || typeof body.messageRef !== "string" || !body.messageRef || typeof body.round !== "number" || typeof body.status !== "string") {
    return { status: 400, body: { error: "round, status, channelRef and messageRef are needed" } };
  }
  item.draft.card = { channelRef: body.channelRef, messageRef: body.messageRef, round: body.round, status: body.status };
  saveShortlists(settings.dataDir, state);
  return { status: 200, body: { ok: true } };
}

export interface PublishOps {
  check: (s: PublishSettings, pr: number, head: string) => Promise<{ reason: string | null; merged: boolean }>;
  merge: (s: PublishSettings, pr: number, head: string) => Promise<void>;
}

/** Publish: checks the pull request now and answers; a ready one merges in the background and its card follows. */
export async function draftPublish(settings: GhostpenSettings, body: Record<string, unknown>, now: () => Date,
  ops: PublishOps = { check: checkPost, merge: mergePost }): Promise<Reply> {
  const item = findItem(readShortlists(settings.dataDir), body.week, body.index);
  if (!item?.draft) return { status: 404, body: { error: "no such draft" } };
  if (body.user !== settings.shortlist?.operator) return { status: 200, body: { refused: OPERATOR_ONLY } };
  if (stale(item.draft, body)) return { status: 200, body: { refused: OLD_CARD } };
  if (item.draft.status === "published") return { status: 200, body: { reply: "It is on the blog already." } };
  if (item.draft.status === "publishing") return { status: 200, body: { reply: "It is being published now." } };
  if (item.draft.status !== "ready" || !item.draft.pr || !settings.publish) return { status: 200, body: { refused: "This draft is not ready to publish, so nothing was done." } };
  const reason = typeof body.reason === "string" ? body.reason.trim().split("\n")[0]!.slice(0, 200) : "";
  if (!reason) return { status: 200, body: { refused: "A Publish needs a reason, so nothing was done." } };
  const publish = settings.publish, pr = item.draft.pr.number, head = item.draft.pr.head;
  let checked: { reason: string | null; merged: boolean };
  try { checked = await ops.check(publish, pr, head); } catch (error) {
    return { status: 200, body: { refused: `ghostpen could not check the pull request, so nothing changed: ${firstLine(error)}` } };
  }
  // The check took a moment: the draft must still be the one checked (no Edit, no other press since), or nothing is done.
  const fresh = findItem(readShortlists(settings.dataDir), body.week, body.index)?.draft;
  if (!fresh || fresh.round !== item.draft.round || fresh.status !== "ready" || fresh.pr?.number !== pr) {
    return { status: 200, body: { refused: "The draft changed while ghostpen checked it; use the newest card. Nothing was done." } };
  }
  if (checked.merged) {
    setStatus(settings, body, now(), "published");
    addFeedback(settings.dataDir, { at: now().toISOString(), by: String(body.user), topic: item.id, kind: "reason", action: "publish", chip: body.chip === true, text: reason });
    return { status: 200, body: { reply: "It is on the blog already." } };
  }
  if (checked.reason) return { status: 200, body: { refused: `Not published yet: ${checked.reason}.` } };
  setStatus(settings, body, now(), "publishing");
  addFeedback(settings.dataDir, { at: now().toISOString(), by: String(body.user), topic: item.id, kind: "reason", action: "publish", chip: body.chip === true, text: reason });
  void ops.merge(publish, pr, head).then(() => setStatus(settings, body, now(), "published"),
    (error: unknown) => setStatus(settings, body, now(), "ready", `the merge failed: ${firstLine(error)}`));
  return { status: 200, body: { reply: "Publishing now; its card says when it is on the blog." } };
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300);

/** Moves the draft's status, reading the state fresh so a change made meanwhile is kept. */
function setStatus(settings: GhostpenSettings, body: Record<string, unknown>, now: Date, status: DraftState["status"], problem?: string): void {
  const state = readShortlists(settings.dataDir);
  const item = findItem(state, body.week, body.index);
  if (!item?.draft) return;
  item.draft.status = status;
  item.draft.at = now.toISOString();
  if (problem) item.draft.problem = problem; else delete item.draft.problem;
  saveShortlists(settings.dataDir, state);
}

export function draftEdit(settings: GhostpenSettings, body: Record<string, unknown>, now: Date, jobs: DraftJobs | undefined): Reply {
  const state = readShortlists(settings.dataDir);
  const item = findItem(state, body.week, body.index);
  if (!item?.draft) return { status: 404, body: { error: "no such draft" } };
  if (body.user !== settings.shortlist?.operator) return { status: 200, body: { refused: OPERATOR_ONLY } };
  if (stale(item.draft, body)) return { status: 200, body: { refused: OLD_CARD } };
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : "";
  if (!notes) return { status: 200, body: { refused: "An Edit needs the changes you want, so nothing was done." } };
  if (!["ready", "failed", "error"].includes(item.draft.status)) return { status: 200, body: { refused: "This draft cannot be edited now, so nothing was done." } };
  if (!jobs) return { status: 200, body: { refused: "ghostpen is not drafting here (settings.draft), so nothing was done." } };
  item.draft.status = "queued";
  item.draft.round += 1;
  item.draft.notes = notes;
  addFeedback(settings.dataDir, { at: now.toISOString(), by: String(body.user), topic: item.id, kind: "reason", action: "edit", text: notes });
  item.draft.at = now.toISOString();
  saveShortlists(settings.dataDir, state);
  jobs.enqueue(body.week as string, body.index as number);
  return { status: 200, body: { reply: "The writer is making your changes; the new draft comes here when it is ready." } };
}
