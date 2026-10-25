// ghostpen's install as Relay runs it (`relay instance install-adapters`; updates go through Relay as chatter's do):
// Obsidian's catalogue entry for ghostpen names this script, and an instance opts in with its stack.yaml
// `install_inputs`. Relay runs it in that instance's own ghostpen checkout, `<root>/checkout` (no two chatters share
// one, Relay#391), with RELAY_INSTANCE, RELAY_INSTANCES_ROOT (Obsidian's ensemble/personal-instances) and one
// RELAY_INPUT_<NAME> per input; this maps them onto adapter/scripts/install-host.sh (adapter/docs/install.md), which
// builds that checkout's adapter/ and restarts a running service. Beside a container chatter (its facts file
// `instance-facts.json` beside <root>) it refuses: ghostpen has no container install yet.
//
//   inputs: port, dropin_dir (an absolute path); optional: chatter_facts (chatter's instance-facts.json, absolute)
// The stack is the instance's config/stack.yaml.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const INPUTS = ["port", "dropin_dir"];
export const OPTIONAL_INPUTS = ["chatter_facts"];
const INSTANCE = /^[a-z0-9][a-z0-9-]{0,62}$/;
// The repository root: this file is <checkout>/adapter/scripts/relay-install.mjs.
const CHECKOUT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** install-host.sh's arguments from Relay's environment, run in `cwd`; any missing or malformed value refuses. */
export function installArgs(env, cwd, checkout = CHECKOUT) {
  const value = name => {
    const v = env[`RELAY_INPUT_${name.toUpperCase()}`];
    if (!v) throw new Error(`Relay gave no ${name} input (RELAY_INPUT_${name.toUpperCase()})`);
    return v;
  };
  const instance = env.RELAY_INSTANCE ?? "";
  if (!INSTANCE.test(instance)) throw new Error("RELAY_INSTANCE must name an instance");
  const root = env.RELAY_INSTANCES_ROOT;
  if (!root || !isAbsolute(root) || basename(root) !== "personal-instances" || basename(dirname(root)) !== "ensemble")
    throw new Error("RELAY_INSTANCES_ROOT must be an Obsidian checkout's absolute ensemble/personal-instances");
  // The checkout install-host.sh builds is <root>/checkout: it must be the one Relay runs this script from.
  if (basename(cwd) !== "checkout" || realpathSync(cwd) !== realpathSync(checkout))
    throw new Error(`Relay must run this in the instance's ghostpen checkout (<root>/checkout), not ${cwd}`);
  const port = value("port"), dropin = value("dropin_dir");
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error("the port input must be a port from 1024 to 65535 (the settings refuse any other)");
  if (!isAbsolute(dropin)) throw new Error("the dropin_dir input must be an absolute path");
  const ghostpenRoot = dirname(realpathSync(cwd));
  const besideFacts = join(dirname(ghostpenRoot), "instance-facts.json");
  if (existsSync(besideFacts))
    throw new Error(`chatter's facts ${besideFacts} sit beside ${ghostpenRoot}: ghostpen beside a container chatter is not installable yet`);
  const facts = env.RELAY_INPUT_CHATTER_FACTS;
  if (facts !== undefined && facts !== "" && !isAbsolute(facts)) throw new Error("the chatter_facts input must be an absolute path");
  return ["--instance", instance, "--root", ghostpenRoot, "--port", port, "--dropin-dir", dropin,
    "--stack", join(root, instance, "config", "stack.yaml"), ...(facts ? ["--chatter-facts", facts] : [])];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try { args = installArgs(process.env, process.cwd()); } catch (error) { console.error(`relay-install: ${error.message}`); process.exit(2); }
  const run = spawnSync("bash", [join(dirname(fileURLToPath(import.meta.url)), "install-host.sh"), ...args], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}
