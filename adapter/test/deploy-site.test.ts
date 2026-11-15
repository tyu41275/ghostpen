import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const script = join(__dirname, "..", "..", "scripts", "deploy-site.sh");
const TOKEN = "tok-test-5ec7e7-value";
const URL = "https://ghostpen-test-abc123.vercel.app";

interface Run { code: number; out: string; calls: string[] }

/**
 * Runs the script with stand-ins for `node` (the yarn install) and `npx` (the Vercel CLI) first on PATH. Each records
 * its argv, and the content variables it sees, to one file; `npx` answers `deploy` with a URL and fails `fail`'s call.
 */
async function run(env: Record<string, string>, args: string[] = [], fail?: string, pulled?: string): Promise<Run> {
  const dir = tempDir(), bin = join(dir, "bin"), calls = join(dir, "calls");
  mkdirSync(bin);
  writeFileSync(calls, "");
  const record = `printf '%s | REQUIRE=%s CONTENT=%s DIST=%s HUSKY=%s\\n' "$0 $*" "\${GHOSTPEN_REQUIRE_CONTENT-unset}" ` +
    `"\${GHOSTPEN_CONTENT_DIR-unset}" "\${GHOSTPEN_DIST_DIR-unset}" "\${HUSKY-unset}" >> ${calls}\n`;
  writeFileSync(join(bin, "node"), `#!/bin/sh\n${record}exit 0\n`, { mode: 0o755 });
  // With `pulled`, the script runs from a copy in the temp folder and `pull` writes that file where the real CLI would.
  let target = script;
  if (pulled !== undefined) {
    mkdirSync(join(dir, "root", "scripts"), { recursive: true });
    copyFileSync(script, (target = join(dir, "root", "scripts", "deploy-site.sh")));
    copyFileSync(join(script, "..", "..", ".yarnrc.yml"), join(dir, "root", ".yarnrc.yml"));
    writeFileSync(join(dir, "pulled"), pulled);
  }
  const pull = pulled === undefined ? "" : `[ "$3" = pull ] && mkdir -p .vercel && cp ${join(dir, "pulled")} .vercel/.env.production.local\n`;
  writeFileSync(join(bin, "npx"), `#!/bin/sh\n${record}${pull}[ "$3" = "${fail ?? "-"}" ] && exit 1\n` +
    `[ "$3" = deploy ] && echo ${URL}\nexit 0\n`, { mode: 0o755 });
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const full = { PATH: `${bin}:${process.env.PATH}`, HOME: dir, TMPDIR: dir, ...env };
  for (const [k, v] of Object.entries(full)) if (v === "@token-file") full[k] = tokenFile;
  try {
    const { stdout, stderr } = await promisify(execFile)("bash", [target, ...args], { env: full });
    return { code: 0, out: stdout + stderr, calls: lines(calls) };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}`, calls: lines(calls) };
  }
}

const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
const cli = (calls: string[]) => calls.filter((c) => c.includes("/npx "));
const ALL = { GHOSTPEN_CONTENT_DIR: "/srv/content", VERCEL_TOKEN_FILE: "@token-file", VERCEL_ORG_ID: "team_x",
  VERCEL_PROJECT_ID: "prj_x", GHOSTPEN_DIST_DIR: ".next-other" };

describe("deploy-site.sh", () => {
  it("refuses in one line naming every missing input, and runs nothing", async () => {
    const r = await run({ VERCEL_ORG_ID: "team_x" });
    expect(r.code).not.toBe(0);
    expect(r.out.trim()).toBe("deploy-site: missing GHOSTPEN_CONTENT_DIR, VERCEL_TOKEN_FILE (or VERCEL_TOKEN), VERCEL_PROJECT_ID");
    expect(r.calls).toEqual([]);
  });

  it("installs, then pulls, builds and deploys the prebuilt site to production with the file's token, and prints the URL", async () => {
    const r = await run(ALL);
    expect(r.code).toBe(0);
    expect(r.calls[0]).toMatch(/\/node \S+\/\.yarn\/releases\/yarn-[\d.]+\.cjs install --immutable \|.* HUSKY=0$/);
    const calls = cli(r.calls);
    const version = /vercel@(\d+\.\d+\.\d+) /.exec(calls[0] ?? "")?.[1];
    expect(version).toBeTruthy();
    expect(calls.map((c) => c.split(" | ")[0].replace(/^\S*npx/, "npx"))).toEqual([
      `npx --yes vercel@${version} pull --yes --environment=production --token ${TOKEN}`,
      `npx --yes vercel@${version} build --prod --token ${TOKEN}`,
      `npx --yes vercel@${version} deploy --prebuilt --prod --token ${TOKEN}`,
    ]);
    for (const c of r.calls) expect(c).toContain("| REQUIRE=1 CONTENT=/srv/content DIST=unset HUSKY=0");
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).toContain(`deploy-site: deployed ${URL}`);
  });

  it("takes the token from VERCEL_TOKEN when no file is named", async () => {
    const r = await run({ ...ALL, VERCEL_TOKEN_FILE: "", VERCEL_TOKEN: "tok-env-value" });
    expect(r.code).toBe(0);
    expect(cli(r.calls).every((c) => c.includes("--token tok-env-value |"))).toBe(true);
    expect(r.out).not.toContain("tok-env-value");
  });

  it("with --build-only pulls and builds but does not deploy", async () => {
    const r = await run(ALL, ["--build-only"]);
    expect(r.code).toBe(0);
    expect(cli(r.calls).map((c) => c.split(" ")[3])).toEqual(["pull", "build"]);
    expect(r.out).toMatch(/built into \S+\/\.vercel\/output \(not deployed\)/);
  });

  it("refuses to build when the project's pulled production variables set GHOSTPEN_*, and builds when they do not", async () => {
    for (const line of ["GHOSTPEN_REQUIRE_CONTENT=\"0\"", "export GHOSTPEN_CONTENT_DIR=/elsewhere"]) {
      const r = await run(ALL, [], undefined, `VERCEL_ENV="production"\n${line}\n`);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("deploy-site: the Vercel project sets GHOSTPEN_* variables for production");
      expect(cli(r.calls).map((c) => c.split(" ")[3])).toEqual(["pull"]);
    }
    const ok = await run(ALL, ["--build-only"], undefined, `VERCEL_ENV="production"\nNOT_GHOSTPEN_X=1\n`);
    expect(ok.code).toBe(0);
    expect(cli(ok.calls).map((c) => c.split(" ")[3])).toEqual(["pull", "build"]);
  });

  it("stops without deploying when the build fails", async () => {
    const r = await run(ALL, [], "build");
    expect(r.code).not.toBe(0);
    expect(cli(r.calls).map((c) => c.split(" ")[3])).toEqual(["pull", "build"]);
    expect(r.out).not.toContain(TOKEN);
  });
});
