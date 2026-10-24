// The `instance:` and `adapters:` of an instance's Obsidian `config/stack.yaml`, for scripts/allowed-here.mjs (ADR 0030).
// Read with the `yaml` parser chatter reads the same file with, so the install gate and chatter's own check agree on
// what the file says. A file that is not one YAML mapping, a key given twice, an alias, or either key missing or of
// another type refuses, naming why: nothing is allowed that could not be read.
import { parseDocument } from "yaml";

/** An instance name (src/settings.ts). */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
/** An adapter id as chatter checks the allowed list (ensemble-chatter src/adapter-loader/optional-adapters.ts): no dots. */
const ADAPTER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

/** `{instance, adapters}` from the file's text; throws, naming the problem. */
export function readAllowed(text) {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) throw new Error(`it is not YAML this gate can read: ${doc.errors[0].message.split("\n")[0]}`);
  let found;
  try {
    found = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`it is not YAML this gate can read: ${error.message.split("\n")[0]}`);
  }
  if (!found || typeof found !== "object" || Array.isArray(found)) throw new Error("it is not a mapping");
  if (typeof found.instance !== "string" || !NAME.test(found.instance)) throw new Error("instance: is missing or not a name");
  if (found.adapters === undefined) throw new Error("adapters: is missing");
  if (!Array.isArray(found.adapters)) throw new Error("adapters: is not a list");
  for (const id of found.adapters) if (typeof id !== "string" || !ADAPTER_ID.test(id)) throw new Error("adapters: an item is not an adapter id");
  const lower = found.adapters.map((id) => id.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new Error("adapters: an id is listed twice");
  return { instance: found.instance, adapters: lower };
}
