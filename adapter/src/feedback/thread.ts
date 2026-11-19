/**
 * A card's thread: the operator asks why a topic is there, or adds context for it. Any
 * message in the thread ghostpen opened under a card, or in a thread the operator opened on the card himself (on
 * Discord that thread's id is the card's message id), is about that card's topic. Where drafting is set up
 * (`settings.draft`), ghostpen answers on a `ghostpen.thread-answer` model turn chatter runs (ghostpen#146) from the topic's
 * source documents, its scores with their quoted lines, and the thread so far, in plain words, and says so when the
 * sources do not hold the answer.
 * Context is kept on the topic for the writer; it never changes a score.
 */
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { candidatesOf } from "../ranking/candidates.js";
import { isRankingView, RANKING_FILE } from "../ranking/run.js";
import { writerTimeoutMs, type GhostpenSettings } from "../settings.js";
import { readShortlists } from "../shortlist/state.js";
import { readSources } from "../sources/read.js";
import type { TurnAsker, TurnPersona } from "../turns/queue.js";
import type { Ran } from "../turns/ran.js";
import { addFeedback, readFeedback } from "./store.js";

const MAX_LINES = 300;
const MAX_REPLY = 1900;
const HISTORY = 12;
/** The thread answer's model turn (ghostpen#146): chatter runs it on this persona's route. */
export const THREAD_PERSONA: TurnPersona = "ghostpen.thread-answer";
/** The version of `THREAD_INSTRUCTIONS`: bump it with any change to them (`test/instructions-versions.test.ts` pins them). */
export const THREAD_VERSION = "1";
/** The answerer's fixed instructions, ahead of the topic's material. */
export const THREAD_INSTRUCTIONS: readonly string[] = [
  "You are ghostpen, the author's blog helper. The author wrote in the thread under one of your proposals.",
  "Write so a 10-year-old could follow: short sentences, every unusual word explained.",
  "If the message asks something, answer it from the material below only; if the material does not hold the answer, say so plainly.",
  "If the message gives context (facts, opinions, what to stress or avoid), thank the author in one short sentence and say it will go to the writer.",
  "Answer with one JSON object and nothing else: {\"kind\": \"question\" | \"context\" | \"both\", \"reply\": \"<your reply, at most 1500 characters>\"}",
];

/** The topic a thread belongs to, or null when it is no card's thread. */
export function threadTopic(dataDir: string, thread: string): { topic: string; title: string } | null {
  if (!thread) return null;
  for (const { items } of Object.values(readShortlists(dataDir).weeks)) {
    for (const item of items) {
      const refs = [item.posted?.threadRef, item.posted?.messageRef, item.draft?.card?.threadRef, item.draft?.card?.messageRef];
      if (refs.includes(thread)) return { topic: item.id, title: item.draft?.title ?? item.text.split("\n")[0]!.replace(/\*\*/gu, "") };
    }
  }
  return null;
}

/** The prompt: the plain-words rule, the topic's sources and scores, the thread so far, and the new message. */
export async function threadPrompt(settings: GhostpenSettings, topic: string, title: string, message: string): Promise<string> {
  const read = await readSources(settings);
  const part = topic.startsWith("background:") ? topic.slice("background:".length) : null;
  const documents = part
    ? read.documents.filter((d) => d.lines.join("\n").toLowerCase().includes(part.toLowerCase())).slice(0, 3)
    : candidatesOf(read.documents).filter((c) => c.id === topic).map((c) => c.document);
  const definition = part ? read.definitions.find((d) => d.term.toLowerCase() === part.toLowerCase()) : undefined;
  const rankingPath = join(settings.dataDir, RANKING_FILE);
  const ranking = existsSync(rankingPath) ? JSON.parse(readFileSync(rankingPath, "utf8")) as unknown : null;
  const entry = isRankingView(ranking) ? ranking.entries.find((e) => e.id === topic) : undefined;
  const history = readFeedback(settings.dataDir).filter((e) => e.topic === topic && e.kind !== "reason").slice(-HISTORY)
    .map((e) => `${e.kind === "answer" ? "ghostpen" : "author"} (${e.kind}): ${e.text}`);
  return [
    ...THREAD_INSTRUCTIONS,
    "", `Proposal: ${title}`,
    entry ? `Ranked ${entry.total}: ${entry.topic}. A reader leaves with: ${entry.takeaway}` : "This topic has no ranking entry.",
    ...(entry?.scores ?? []).map((s) => `- ${s.factor} ${s.score}/3${s.quote ? `: "${s.quote}"` : ""}${s.note ? ` (${s.note})` : ""}`),
    ...(definition ? ["", `Glossary: ${definition.term}: ${definition.text}`] : []),
    ...documents.flatMap((d) => ["", `### ${d.title}`, ...d.lines.slice(0, MAX_LINES)]),
    ...(history.length ? ["", "The thread so far:", ...history] : []),
    "", `The author's new message: ${message}`,
  ].join("\n");
}

/** What the answerer said, checked: its kind and its reply, clipped. */
export function parseThreadAnswer(output: string): { kind: "question" | "context" | "both"; reply: string } {
  const start = output.indexOf("{"), end = output.lastIndexOf("}");
  let value: Record<string, unknown> = {};
  try { if (start >= 0 && end > start) value = JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>; } catch { value = {}; }
  const kind = value.kind === "question" || value.kind === "context" || value.kind === "both" ? value.kind : null;
  const reply = typeof value.reply === "string" ? value.reply.trim() : "";
  if (!kind || !reply) throw new Error("the answer was not the JSON asked for");
  return { kind, reply: reply.length > MAX_REPLY ? `${reply.slice(0, MAX_REPLY)}…` : reply };
}

/**
 * One message in a card's thread: answer it on a model turn (`turns`, the service's) and keep it. With no drafting set up
 * (`settings.draft`) nothing is asked. The message is kept whenever the answer fails, so context is never lost to a failed
 * answer; a failed answer says so in plain words. The answer's entry keeps what its turn ran on.
 */
export async function answerInThread(settings: GhostpenSettings, input: { topic: string; title: string; user: string; text: string; now: Date },
  turns?: TurnAsker): Promise<string> {
  const at = input.now.toISOString();
  if (!settings.draft || !turns) {
    addFeedback(settings.dataDir, { at, by: input.user, topic: input.topic, kind: "context", text: input.text });
    return settings.draft ? "Kept as context for this topic. ghostpen cannot ask chatter for an answer here, so it cannot answer questions."
      : "Kept as context for this topic. ghostpen has no drafting set up here (settings.draft), so it cannot answer questions.";
  }
  let answer: { kind: "question" | "context" | "both"; reply: string };
  let ran: Ran;
  try {
    const prompt = await threadPrompt(settings, input.topic, input.title, input.text);
    const turn = await turns.ask(THREAD_PERSONA, THREAD_VERSION, prompt, writerTimeoutMs(settings.draft));
    answer = parseThreadAnswer(turn.text);
    ran = turn.ran;
  } catch (error) {
    addFeedback(settings.dataDir, { at, by: input.user, topic: input.topic, kind: "context", text: input.text });
    return `Kept your message as context for this topic, but ghostpen could not answer it: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200)}.`;
  }
  if (answer.kind !== "question") addFeedback(settings.dataDir, { at, by: input.user, topic: input.topic, kind: "context", text: input.text });
  if (answer.kind !== "context") addFeedback(settings.dataDir, { at, by: input.user, topic: input.topic, kind: "question", text: input.text });
  addFeedback(settings.dataDir, { at, by: "ghostpen", topic: input.topic, kind: "answer", text: answer.reply, ran });
  return answer.reply;
}
