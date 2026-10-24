// `node scripts/allowed-here.mjs <stack.yaml> <instance>`: exits 0 only when the instance's Obsidian `config/stack.yaml`
// names that instance and lists `ghostpen` under `adapters:` (ADR 0030, docs/install.md); otherwise it says why and exits 1.
// It reads the file with the checkout's `yaml` dependency (scripts/allowed-list.mjs).
import { readFileSync, statSync } from "node:fs";
import { readAllowed } from "./allowed-list.mjs";

const MAX_BYTES = 256 * 1024; // chatter reads no larger allowed list (docs/optional-adapters.md in ensemble-chatter)

const [file, instance] = process.argv.slice(2);
try {
  if (!file || !instance) throw new Error("usage: node scripts/allowed-here.mjs <stack.yaml> <instance>");
  if (statSync(file).size > MAX_BYTES) throw new Error("it is larger than 256 KiB");
  const allowed = readAllowed(readFileSync(file, "utf8"));
  if (allowed.instance !== instance) throw new Error(`it is instance ${allowed.instance}'s, not ${instance}'s`);
  if (!allowed.adapters.includes("ghostpen")) throw new Error("its adapters: list does not allow ghostpen");
} catch (error) {
  console.error(`${file ?? "stack.yaml"}: ${error.message}: ghostpen is not installed (ADR 0030; allow it in Obsidian first)`);
  process.exit(1);
}
