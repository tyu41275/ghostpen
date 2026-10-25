import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain script with no types; Relay runs it before anything is built.
import { INPUTS, installArgs, OPTIONAL_INPUTS } from "../scripts/relay-install.mjs";
import { tempDir } from "./helpers.js";

function world() {
  const home = tempDir();
  const checkout = join(home, "ghostpen", "checkout");
  const instances = join(home, "obsidian", "ensemble", "personal-instances");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(join(instances, "personal-comms-host", "config"), { recursive: true });
  const env: Record<string, string> = { RELAY_INSTANCE: "personal-comms-host", RELAY_INSTANCES_ROOT: instances,
    RELAY_INPUT_PORT: "8794", RELAY_INPUT_DROPIN_DIR: join(home, "adapters.d") };
  return { home, checkout, instances, env };
}

describe("relay-install.mjs", () => {
  it("maps Relay's inputs onto install-host.sh for the checkout it runs in", () => {
    const { home, checkout, instances, env } = world();
    expect(INPUTS).toEqual(["port", "dropin_dir"]);
    expect(OPTIONAL_INPUTS).toEqual(["chatter_facts"]);
    expect(installArgs({ ...env, RELAY_INPUT_CHATTER_FACTS: "/run/facts.json" }, checkout, checkout).slice(-2)).toEqual(["--chatter-facts", "/run/facts.json"]);
    expect(() => installArgs({ ...env, RELAY_INPUT_CHATTER_FACTS: "facts.json" }, checkout, checkout)).toThrow("chatter_facts input must be an absolute path");
    expect(installArgs(env, checkout, checkout)).toEqual(["--instance", "personal-comms-host", "--root", join(home, "ghostpen"),
      "--port", "8794", "--dropin-dir", join(home, "adapters.d"), "--stack", join(instances, "personal-comms-host", "config", "stack.yaml")]);
  });

  it("runs only in the checkout the script is from, named checkout, an alias of it included", () => {
    const { home, checkout, env } = world();
    symlinkSync(checkout, join(home, "checkout"));
    expect(installArgs(env, join(home, "checkout"), checkout)).toContain(join(home, "ghostpen"));
    const other = join(home, "other", "checkout");
    mkdirSync(other, { recursive: true });
    expect(() => installArgs(env, other, checkout)).toThrow("the instance's ghostpen checkout");
    expect(() => installArgs(env, join(home, "ghostpen"), join(home, "ghostpen"))).toThrow("the instance's ghostpen checkout");
  });

  it("refuses beside a container chatter, and any missing or malformed input", () => {
    const { home, checkout, env } = world();
    for (const [change, why] of [[{ RELAY_INSTANCE: "Bad Name" }, "RELAY_INSTANCE must name an instance"],
      [{ RELAY_INSTANCES_ROOT: "/tmp/elsewhere" }, "RELAY_INSTANCES_ROOT must be"], [{ RELAY_INPUT_PORT: "" }, "Relay gave no port input"],
      [{ RELAY_INPUT_PORT: "80" }, "port from 1024 to 65535"], [{ RELAY_INPUT_DROPIN_DIR: "adapters.d" }, "dropin_dir input must be an absolute path"]] as const) {
      expect(() => installArgs({ ...env, ...change }, checkout, checkout)).toThrow(why);
    }
    writeFileSync(join(home, "instance-facts.json"), "{}");
    expect(() => installArgs(env, checkout, checkout)).toThrow("not installable yet");
  });
});
