import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readAppKey } from "../src/service/app-identity.js";
import { readSettings } from "../src/settings.js";
import { tempDir } from "./helpers.js";

const script = join(__dirname, "..", "scripts", "install-host.sh");
const UNIT = "ghostpen-personal-comms-host.service";
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve)); });

/** A loopback port where a stand-in answers `/health` as `instance`; without one, nothing listens there. */
async function port(instance?: string): Promise<string> {
  const server = createServer((_req, res) => { res.writeHead(200); res.end(JSON.stringify({ ok: true, instance, version: "0.1.0" })); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port: number } = server.address() as AddressInfo;
  if (instance === undefined) await new Promise((resolve) => server.close(resolve)); else servers.push(server);
  return String(number);
}

function home(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "ghostpen", "checkout", ".git"), { recursive: true });
  return dir;
}

/** Runs the install with a systemctl stand-in; answers systemctl's calls, or rejects with the script's error. */
async function install(dir: string, options: { active?: boolean; port?: string; stack?: string } = {}): Promise<string[]> {
  const calls = join(dir, "systemctl.calls");
  writeFileSync(calls, "");
  const stub = join(dir, "systemctl");
  writeFileSync(stub, `#!/bin/sh\necho "$@" >> ${calls}\n[ "$2" = is-active ] && exit ${options.active ? 0 : 3}\nexit 0\n`, { mode: 0o755 });
  const stack = join(dir, "stack.yaml");
  writeFileSync(stack, options.stack ?? "version: 1\ninstance: personal-comms-host\nadapters: [tempo, ghostpen]\n");
  await promisify(execFile)("bash", [script, "--instance", "personal-comms-host", "--root", join(dir, "ghostpen"),
    "--port", options.port ?? "8794", "--dropin-dir", join(dir, "adapters.d"), "--stack", stack], {
    env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), GHOSTPEN_INSTALL_SYSTEMCTL: stub,
      GHOSTPEN_INSTALL_SKIP_BUILD: "1", GHOSTPEN_INSTALL_HEALTH_WAIT: "1" } });
  return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean);
}

const refusal = async (fn: () => Promise<unknown>): Promise<string> => {
  try { await fn(); } catch (error) { return String((error as { stderr?: string }).stderr ?? error); }
  throw new Error("the install was not refused");
};

describe("install-host.sh", () => {
  it("creates the settings, app key and adapter config once, installs the unit and a drop-in with the app, and restarts only a running service", async () => {
    const dir = home(), root = join(dir, "ghostpen"), config = join(root, "config"), settingsFile = join(config, "settings.json");
    const at = await port("personal-comms-host");
    expect(await install(dir, { port: at })).toEqual(["--user daemon-reload", `--user is-active --quiet ${UNIT}`]);
    const appKey = join(config, "app-identity.key");
    expect(readSettings(settingsFile)).toEqual({ instance: "personal-comms-host", port: Number(at), dataDir: join(root, "data"), appIdentityKeyFile: appKey, sources: { topics: [], references: [] } });
    expect(readAppKey(appKey).length).toBe(32);
    for (const file of [settingsFile, appKey]) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(config, "chatter-adapter.json"), "utf8"))).toEqual({ settingsFile });
    expect(readFileSync(join(dir, "config", "systemd", "user", UNIT), "utf8"))
      .toMatch(new RegExp(`ExecStart=\\S+ ${join(root, "checkout")}/adapter/dist/service/main\\.js ${settingsFile}\\n`, "u"));
    const dropin = join(dir, "adapters.d", "ghostpen.json");
    expect(JSON.parse(readFileSync(dropin, "utf8"))).toEqual({ version: 1, key: "ghostpen", entry: { key: "ghostpen",
      module: join(root, "checkout", "adapter"), config: join(config, "chatter-adapter.json"), namespaces: ["ghostpen"],
      optional: { label: "ghostpen", start: ["systemctl", "--user", "enable", "--now", UNIT],
        stop: ["systemctl", "--user", "disable", "--now", UNIT], cancelJobs: ["/bin/true"], health: { port: Number(at), path: "/health" },
        app: { kind: "standalone-app", port: Number(at), path: "/app/", identityKeyFile: appKey } } } });
    expect(statSync(dropin).mode & 0o777).toBe(0o600);

    // An update keeps the settings, the key and the adapter config, and restarts the running service onto the new build.
    const key = readFileSync(appKey, "utf8");
    writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, "utf8")), dataDir: join(dir, "kept") }));
    expect((await install(dir, { active: true, port: at })).slice(-2)).toEqual([`--user is-active --quiet ${UNIT}`, `--user restart ${UNIT}`]);
    expect(readSettings(settingsFile).dataDir).toBe(join(dir, "kept"));
    expect(readFileSync(appKey, "utf8")).toBe(key);
  });

  it("installs nothing where the instance's stack.yaml does not allow ghostpen", async () => {
    for (const stack of ["version: 1\ninstance: personal-comms-host\nadapters: [tempo]\n", "version: 1\ninstance: another\nadapters: [ghostpen]\n"]) {
      const dir = home();
      expect(await refusal(() => install(dir, { stack }))).toMatch(/ghostpen is not installed/u);
      expect(existsSync(join(dir, "ghostpen", "config"))).toBe(false);
      expect(existsSync(join(dir, "adapters.d"))).toBe(false);
    }
  });

  it("refuses a moved port, a restarted service that does not answer as this instance, and relative paths", async () => {
    const moved = home();
    await install(moved);
    expect(await refusal(() => install(moved, { port: "8795" }))).toMatch(/--port 8795 differs from port 8794/u);
    const silent = home(), nobody = await port();
    expect(await refusal(() => install(silent, { active: true, port: nobody }))).toMatch(/was restarted but does not answer as it/u);
    const other = home(), wrong = await port("someone-else");
    expect(await refusal(() => install(other, { active: true, port: wrong }))).toMatch(/does not answer as it/u);
    const relative = home();
    const run = promisify(execFile)("bash", [script, "--instance", "personal-comms-host", "--root", "ghostpen", "--port", "8794",
      "--dropin-dir", join(relative, "d"), "--stack", join(relative, "s.yaml")]);
    expect(await refusal(() => run)).toMatch(/--root must be absolute/u);
  });
});
