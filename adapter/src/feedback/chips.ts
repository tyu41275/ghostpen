/**
 * The short reasons a card offers for each press (ADR 0101, amended 2026-10-25; Reflection D6: "a chip counts"). A
 * reason not on the list is typed through the button itself ("Other…"). Values are `<action>:<n>`, so a choice names
 * its press and its words.
 */
export type ReasonAction = "write" | "skip" | "later" | "publish";

export const CHIPS: Record<ReasonAction, readonly string[]> = {
  write: ["Others would find it useful", "It tells a good story", "Readers have asked about it"],
  skip: ["Too narrow for readers", "Already covered", "Too private to share"],
  later: ["Waiting on the outcome", "Not the right week"],
  publish: ["Accurate and reads well", "Good enough; small fixes can follow"],
};
const VERB: Record<ReasonAction, string> = { write: "Write", skip: "Skip", later: "Not yet", publish: "Publish" };

/** A select's options for these presses: "Write: Others would find it useful", and so on. */
export const chipOptions = (actions: readonly ReasonAction[]) =>
  actions.flatMap((action) => CHIPS[action].map((words, n) => ({ label: `${VERB[action]}: ${words}`, value: `${action}:${n}` })));

/** The press and words a chosen value stands for, or null for a value no card offers. */
export function chipOf(value: unknown, allowed: readonly ReasonAction[]): { action: ReasonAction; reason: string } | null {
  const m = typeof value === "string" ? /^([a-z]+):(\d+)$/u.exec(value) : null;
  const action = m?.[1] as ReasonAction | undefined;
  if (!action || !allowed.includes(action)) return null;
  const reason = CHIPS[action][Number(m![2])];
  return reason ? { action, reason } : null;
}
