/**
 * The routes ghostpen's chatter adapter calls (ghostpen#89), behind the adapter key (`Authorization: Bearer <key>`, the
 * key in the settings' `adapterKeyFile`; without one they answer 404, as for routes that do not exist):
 *
 *   GET  /v1/adapter/shortlist           this week's shortlist (made on first ask from the last ranking), where to post
 *   POST /v1/adapter/shortlist/posted    {week, index, channelRef, messageRef}: a card was posted
 *   POST /v1/adapter/shortlist/answer    {week, index, action: write|skip|later, reason?, user}: a press, the operator's only
 *
 * Every answer is JSON. The service decides; the adapter only posts and relays presses.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readChoices, recordChoice } from "../ranking/choices.js";
import { isRankingView, RANKING_FILE } from "../ranking/run.js";
import type { GhostpenSettings } from "../settings.js";
import { picks } from "../shortlist/picks.js";
import { currentWeek } from "../shortlist/schedule.js";
import { answeredText, readShortlists, saveShortlists, type Action } from "../shortlist/state.js";

export type Reply = { status: number; body: Record<string, unknown> };
const ACTIONS: readonly Action[] = ["write", "skip", "later"];

/** The channel the shortlist goes to: the setting, else the one chatter made for ghostpen (its instance facts). */
function channelOf(settings: GhostpenSettings): string | null {
  if (settings.shortlist?.channel) return settings.shortlist.channel;
  if (!settings.instanceFactsFile || !existsSync(settings.instanceFactsFile)) return null;
  try {
    const facts = JSON.parse(readFileSync(settings.instanceFactsFile, "utf8")) as { adapterChannels?: Record<string, { channelId?: unknown }> };
    const id = facts.adapterChannels?.ghostpen?.channelId;
    return typeof id === "string" && id ? id : null;
  } catch { return null; }
}

function shortlistNow(settings: GhostpenSettings, now: Date): Reply {
  const shortlist = settings.shortlist;
  if (!shortlist) return { status: 200, body: { off: "no shortlist is set (settings.shortlist)" } };
  const channel = channelOf(settings);
  if (!channel) return { status: 200, body: { off: "ghostpen has no channel yet (settings.shortlist.channel, or chatter's instance facts)" } };
  const week = currentWeek(shortlist, now);
  const state = readShortlists(settings.dataDir);
  if (!state.weeks[week]) {
    const path = join(settings.dataDir, RANKING_FILE);
    const view = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as unknown : null;
    if (!isRankingView(view)) return { status: 200, body: { waiting: "nothing is ranked yet" } };
    state.weeks[week] = { madeAt: now.toISOString(), items: picks(view, readChoices(settings.dataDir), shortlist.count) };
    saveShortlists(settings.dataDir, state);
  }
  const items = state.weeks[week]!.items.map((item, index) => ({ index, id: item.id, text: answeredText(item),
    ...(item.posted ? { posted: item.posted } : {}), answered: !!item.answer }));
  return { status: 200, body: { week, channel, operator: shortlist.operator, items } };
}

function item(settings: GhostpenSettings, body: Record<string, unknown>) {
  const state = readShortlists(settings.dataDir);
  const week = typeof body.week === "string" ? state.weeks[body.week] : undefined;
  const index = typeof body.index === "number" ? body.index : -1;
  return { state, week: body.week as string, found: week?.items[index] };
}

export function posted(settings: GhostpenSettings, body: Record<string, unknown>): Reply {
  const { state, found } = item(settings, body);
  if (!found) return { status: 404, body: { error: "no such shortlist item" } };
  if (typeof body.channelRef !== "string" || typeof body.messageRef !== "string" || !body.messageRef) return { status: 400, body: { error: "channelRef and messageRef are needed" } };
  found.posted = { channelRef: body.channelRef, messageRef: body.messageRef };
  saveShortlists(settings.dataDir, state);
  return { status: 200, body: { ok: true } };
}

export function answer(settings: GhostpenSettings, body: Record<string, unknown>, now: Date): Reply {
  const { state, found } = item(settings, body);
  if (!found) return { status: 404, body: { error: "no such shortlist item" } };
  if (body.user !== settings.shortlist?.operator) return { status: 200, body: { refused: "Only the operator can answer ghostpen's shortlist, so nothing was done." } };
  if (found.answer) return { status: 200, body: { text: answeredText(found), posted: found.posted ?? null, already: true } };
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return { status: 400, body: { error: "action must be write, skip or later" } };
  const reason = typeof body.reason === "string" ? body.reason.trim().split("\n")[0]!.slice(0, 200) : "";
  if (action === "skip" && !reason) return { status: 200, body: { refused: "A Skip needs a one-line reason, so nothing was done." } };
  const ranking = existsSync(join(settings.dataDir, RANKING_FILE)) ? JSON.parse(readFileSync(join(settings.dataDir, RANKING_FILE), "utf8")) as unknown : null;
  const entry = isRankingView(ranking) ? ranking.entries.find((e) => e.id === found.id) : undefined;
  recordChoice(settings.dataDir, { candidate: found.id, choice: action === "later" ? "not-yet" : action, reason, scores: entry?.scores ?? [] },
    found.kind === "decision" ? "decision" : "post-mortem", entry?.title ?? found.id, now);
  found.answer = { action, reason, by: String(body.user), at: now.toISOString() };
  saveShortlists(settings.dataDir, state);
  const next = action === "write" ? "Noted: it is next to draft. Drafting comes with ghostpen#90." : action === "skip" ? "Skipped; the reason will tune the ranking."
    : "It comes back in a later week.";
  return { status: 200, body: { text: answeredText(found), posted: found.posted ?? null, reply: next } };
}

/** Routes one adapter request; null when the path is not an adapter route. */
export function adapterRoute(settings: GhostpenSettings, method: string, path: string, body: Record<string, unknown>, now: Date): Reply | null {
  if (path === "/v1/adapter/shortlist" && method === "GET") return shortlistNow(settings, now);
  if (path === "/v1/adapter/shortlist/posted" && method === "POST") return posted(settings, body);
  if (path === "/v1/adapter/shortlist/answer" && method === "POST") return answer(settings, body, now);
  return path.startsWith("/v1/adapter/") ? { status: 405, body: { error: "not allowed" } } : null;
}
