/**
 * What a model turn ran on (ghostpen#146, following Reflection's src/core/ran.ts): the persona chatter routed it to (from
 * its answer: a route may name another than the one asked), the version of the instructions it was sent, and the provider,
 * model, effort and thinking level chatter's answer names. Each is a plain name (1 to 80 letters, digits, `.`, `_`, `:`,
 * `/`, `@` or `-`) or null: an unknown or odd value is null, never guessed, and never free text, so a record or log line
 * that carries it holds no one's words.
 */

export const RAN_KEYS = ["persona", "instructionsVersion", "provider", "model", "effort", "thinkingLevel"] as const;
export type Ran = Record<(typeof RAN_KEYS)[number], string | null>;

const NAME = /^[A-Za-z0-9._:/@-]{1,80}$/u;
/** `value` when it is a plain name, else null. */
export const plainName = (value: unknown): string | null => (typeof value === "string" && NAME.test(value) ? value : null);

/** What chatter's answer `answer` says its turn ran on, sent `instructionsVersion`; a value that is not a plain name is null. */
export function ranOf(answer: object, instructionsVersion: string): Ran {
  const one = answer as Partial<Record<(typeof RAN_KEYS)[number], unknown>>;
  return { persona: plainName(one.persona), instructionsVersion: plainName(instructionsVersion), provider: plainName(one.provider),
    model: plainName(one.model), effort: plainName(one.effort), thinkingLevel: plainName(one.thinkingLevel) };
}
