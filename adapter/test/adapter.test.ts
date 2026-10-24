import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import adapter, { statusText } from "../src/adapter/index.js";
import { createGhostpenServer } from "../src/service/server.js";
import { settingsFile, tempDir } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))); });
const ctx = (config: Record<string, unknown>) => ({ config, log: () => {} });
const status = adapter.commands[0]!;

describe("adapter", () => {
  it("is written against chatter's adapter API 1.0.0 and named ghostpen", () => {
    expect(adapter.name).toBe("ghostpen");
    expect(adapter.version).toBe("1.0.0");
  });

  it("says ghostpen is on when its service answers", async () => {
    const dir = tempDir();
    const server = createGhostpenServer({ instance: "personal-comms-host", dataDir: dir });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    expect(await status.execute({}, ctx({ settingsFile: settingsFile(dir, { port }) })))
      .toBe("ghostpen for personal-comms-host is on and answering.");
  });

  it("says why when the service does not answer, and never throws", async () => {
    const dir = tempDir();
    const reply = await status.execute({}, ctx({ settingsFile: settingsFile(dir, { port: 1 + 65534 }) }));
    expect(reply).toMatch(/^ghostpen is not answering \(.+\)\.$/u);
    expect(await status.execute({}, ctx({}))).toBe("ghostpen is not answering (ghostpen adapter config needs settingsFile).");
    expect(statusText({ answering: false, status: 503, error: "dataDir: /d is not a folder" }))
      .toBe("ghostpen is not answering (HTTP 503; dataDir: /d is not a folder).");
  });

  it("never takes another server on the port, or another instance's ghostpen, for this one", async () => {
    const { createServer } = await import("node:http");
    const dir = tempDir();
    for (const body of [{ hello: "world" }, { ok: true, instance: "other-instance", version: "0.1.0" }, "not json"]) {
      const other = createServer((_req, res) => { res.writeHead(200); res.end(typeof body === "string" ? body : JSON.stringify(body)); });
      servers.push(other);
      await new Promise<void>((done) => other.listen(0, "127.0.0.1", done));
      const port = (other.address() as { port: number }).port;
      expect(await status.execute({}, ctx({ settingsFile: settingsFile(dir, { port }) })))
        .toBe(`ghostpen is not answering (something else answers on port ${port} (not ghostpen for personal-comms-host)).`);
    }
  });
});
