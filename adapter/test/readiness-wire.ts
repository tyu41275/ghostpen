/** Chatter's rules for a readiness list on the wire (its docs/adapter-readiness.md), for tests of ghostpen's list. */
const FIELDS = ["id", "label", "kind", "required", "spends", "state", "why", "since", "fix", "expected_by"];
const WORDS = { kind: ["setting", "source", "job"], spends: ["usage", "behaviour", "none"], state: ["working", "short_of_data", "waiting_for_operator", "not_set_up", "failing", "chosen_off"] };
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

/** Every fault chatter's reader would refuse the list for, from the wire rules in its docs; none means it is taken whole. */
export function faults(body: string): string[] {
  const out: string[] = [], list = JSON.parse(body) as { version: unknown; needs: Array<Record<string, unknown>> };
  if (Buffer.byteLength(body) > 64 * 1024) out.push("over 64 KiB");
  if (list.version !== 1) out.push("version");
  for (const key of Object.keys(list)) if (key !== "version" && key !== "needs") out.push(`top-level ${key}`);
  if (!Array.isArray(list.needs) || list.needs.length < 1 || list.needs.length > 64) out.push("needs count");
  const line = (value: unknown) => typeof value === "string" && value.trim() === value && value.length >= 1 && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value);
  const instant = (value: unknown) => {
    const date = typeof value === "string" ? INSTANT.exec(value) : null;
    return date !== null && Number.isFinite(Date.parse(value as string)) && new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))).getUTCDate() === Number(date[3]);
  };
  const seen = new Set<unknown>();
  for (const need of list.needs) {
    const id = String(need.id);
    for (const key of Object.keys(need)) if (!FIELDS.includes(key)) out.push(`${id}: unknown ${key}`);
    if (typeof need.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id) || id === "readiness-list" || seen.has(id)) out.push(`${id}: id`);
    seen.add(id);
    if (typeof need.label !== "string" || !line(need.label) || need.label.length > 80) out.push(`${id}: label`);
    if (typeof need.required !== "boolean") out.push(`${id}: required`);
    for (const [field, words] of Object.entries(WORDS)) if (!words.includes(need[field] as string)) out.push(`${id}: ${field}`);
    for (const field of ["why", "fix"]) if (!line(need[field])) out.push(`${id}: ${field}`);
    if (!instant(need.since)) out.push(`${id}: since`);
    if (need.state === "short_of_data" ? !instant(need.expected_by) : need.expected_by !== undefined && !instant(need.expected_by)) out.push(`${id}: expected_by`);
  }
  return out;
}
