import { chmodSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGhostpenServer } from "../src/service/server.js";
import { startService } from "../src/service/start.js";
import { identity, KEY, keyFile, settingsFile, tempDir } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))); });

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

const NOW = Date.parse("2026-10-24T22:00:00Z");
const claims = (over: Record<string, unknown> = {}) => ({ aud: "ghostpen", login: "tim", sub: "1", iat: NOW / 1000 - 10, exp: NOW / 1000 + 300, ...over });

describe("service", () => {
  it("answers health while its data folder is there, and 503 saying why once it is gone", async () => {
    const dir = tempDir();
    const data = join(dir, "data");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(data);
    const base = await listen(createGhostpenServer({ instance: "host", dataDir: data }));
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, instance: "host", version: "0.1.0" });
    rmSync(data, { recursive: true });
    const down = await fetch(`${base}/health`);
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ ok: false, error: `dataDir: ${data} is not a folder` });
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it("opens the app only to a person chatter's console signed for ghostpen, with a strict CSP and every value escaped", async () => {
    const base = await listen(createGhostpenServer({ instance: "host<1>", dataDir: tempDir(), appKey: KEY, now: () => NOW }));
    const page = await fetch(`${base}/app/`, { headers: { "x-chatter-identity": identity(claims({ login: "<tim>" })) } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await page.text();
    expect(html).toContain("Signed in as &lt;tim&gt;");
    expect(html).toContain("ghostpen — host&lt;1&gt;");
    expect(html).toContain("Nothing is ranked yet.");
    for (const header of [undefined, identity(claims({ aud: "tempo" })), identity(claims({ exp: NOW / 1000 - 1 })),
      identity(claims(), Buffer.alloc(32, 9)), "v1.garbage.sig"]) {
      const refused = await fetch(`${base}/app/`, header ? { headers: { "x-chatter-identity": header } } : {});
      expect(refused.status).toBe(404);
    }
  });

  it("with no key file the app opens to nobody", async () => {
    const base = await listen(createGhostpenServer({ instance: "host", dataDir: tempDir(), now: () => NOW }));
    expect((await fetch(`${base}/app/`, { headers: { "x-chatter-identity": identity(claims()) } })).status).toBe(404);
  });

  it("starts nothing when the data folder is missing or the named key file is unreadable or short", async () => {
    const dir = tempDir();
    await expect(startService(settingsFile(dir, { dataDir: join(dir, "missing") }), 0)).rejects.toThrow("is not a folder");
    const absent = startService(settingsFile(dir, { appIdentityKeyFile: join(dir, "absent.key") }), 0);
    await expect(absent).rejects.toThrow("appIdentityKeyFile: cannot be read");
    await expect(absent).rejects.not.toThrow(dir);
    const short = join(dir, "short.key");
    writeFileSync(short, Buffer.alloc(8).toString("base64url"));
    await expect(startService(settingsFile(dir, { appIdentityKeyFile: short }), 0)).rejects.toThrow(/^appIdentityKeyFile: must hold base64url text of at least 32 bytes$/u);
    const running = await startService(settingsFile(dir, { appIdentityKeyFile: keyFile(dir) }), 0);
    servers.push(running.server);
    expect((await fetch(`http://127.0.0.1:${running.port}/health`)).status).toBe(200);
  });

  it("reports a data folder it cannot write to", async () => {
    if (process.getuid?.() === 0) return; // root writes anywhere
    const dir = tempDir();
    chmodSync(dir, 0o500);
    try {
      const base = await listen(createGhostpenServer({ instance: "host", dataDir: dir }));
      expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ ok: false, error: `dataDir: ${dir} cannot be written` });
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
