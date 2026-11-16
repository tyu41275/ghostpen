/**
 * scripts/yarn-install.sh (#141): the pinned yarn's install, tried once more only when yarn 3.6.1 crashes in its link
 * step under Node 24, with only the end of its output printed on failure. Each case runs a copy of the script in its
 * own folder, whose .yarnrc.yml names a stand-in yarn release: it records each call and fails as the case asks.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const script = join(__dirname, "..", "..", "scripts", "yarn-install.sh");
const CRASH = "Error: The `onCancel` handler was attached after the promise settled.";

/** Runs the script with a stand-in yarn whose Nth call prints `outputs[N]` and fails ("" passes). */
async function run(outputs: string[]) {
  const root = tempDir(), tmp = tempDir();
  mkdirSync(join(root, "scripts"));
  copyFileSync(script, join(root, "scripts", "yarn-install.sh"));
  writeFileSync(join(root, ".yarnrc.yml"), "yarnPath: .yarn/releases/stand-in.cjs\n");
  mkdirSync(join(root, ".yarn", "releases"), { recursive: true });
  writeFileSync(join(root, ".yarn", "releases", "stand-in.cjs"), `
    const fs = require("fs"), calls = ${JSON.stringify(join(root, "calls"))};
    fs.appendFileSync(calls, process.argv.slice(2).join(" ") + " HUSKY=" + process.env.HUSKY + "\\n");
    const out = ${JSON.stringify(outputs)}[fs.readFileSync(calls, "utf8").trim().split("\\n").length - 1] ?? "";
    if (out) { console.log("x".repeat(5000)); console.error(out); process.exit(1); }`);
  let code = 0, out = "";
  try {
    const r = await promisify(execFile)("bash", [join(root, "scripts", "yarn-install.sh"), "label"], { env: { PATH: process.env.PATH, TMPDIR: tmp } });
    out = r.stdout + r.stderr;
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    code = e.code;
    out = e.stdout + e.stderr;
  }
  const calls = existsSync(join(root, "calls")) ? readFileSync(join(root, "calls"), "utf8").trim().split("\n") : [];
  return { code, out, calls, leftInTmp: readdirSync(tmp) };
}

describe("scripts/yarn-install.sh", () => {
  it("installs once, prints nothing and leaves no log when yarn passes", async () => {
    const r = await run([]);
    expect(r).toEqual({ code: 0, out: "", calls: ["install --immutable HUSKY=0"], leftInTmp: [] });
  });

  it("installs once more after yarn's link-step crash, and passes when that install does", async () => {
    const r = await run([CRASH]);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.out).toBe("label: yarn crashed in its link step (#141); installing once more\n");
    expect(r.leftInTmp).toEqual([]);
  });

  it("stops after the second crash, printing the end of yarn's output with long lines cut", async () => {
    const r = await run([CRASH, CRASH]);
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(2);
    expect(r.out).toContain("label: yarn install failed; the end of its output (long lines cut):\n");
    expect(r.out).toContain(CRASH);
    expect(r.out).not.toContain("x".repeat(401));
    expect(r.leftInTmp).toEqual([]);
  });

  it("never retries any other failure", async () => {
    const r = await run(["YN0028: The lockfile would have been modified by this install, which is explicitly forbidden."]);
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(1);
    expect(r.out).not.toContain("installing once more");
    expect(r.out).toContain("YN0028");
  });
});
