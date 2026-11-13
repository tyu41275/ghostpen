import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RANKING_FILE } from "../src/ranking/run.js";
import { line, rankingOnce, type Facts, type Need } from "../src/service/readiness-reading.js";
import { NEED_LIMIT_MS, NEED_OF_SETTING, NEEDS, READINESS_PATH, readinessList, reading } from "../src/service/readiness.js";
import { createGhostpenServer } from "../src/service/server.js";
import { startService } from "../src/service/start.js";
import { parseSettings, type GhostpenSettings } from "../src/settings.js";
import { saveShortlists } from "../src/shortlist/state.js";
import { ADAPTER_KEY, after, installed, MINUTE, snapshot, STARTED } from "./readiness-seed.js";
import { faults } from "./readiness-wire.js";
import { KEY, tempDir } from "./helpers.js";

const running: Server[] = [];
afterEach(async () => { for (const server of running.splice(0)) await new Promise((done) => { server.closeAllConnections(); server.close(done); }); });

/** A plain request, as chatter's: no key unless given, and no redirect followed. */
const asked = (port: number, path = READINESS_PATH, method = "GET", headers: Record<string, string> = {}) =>
  new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (part: Buffer) => parts.push(part));
      res.on("end", () => { resolve({ status: res.statusCode!, type: String(res.headers["content-type"]), body: Buffer.concat(parts).toString("utf8") }); });
    }).on("error", reject).end();
  });
const started = async (file: string) => {
  const service = await startService(file, 0);
  running.push(service.server);
  return service.port;
};
const KEY_TEXT = KEY.toString("base64url");
const statesOf = (body: string) => Object.fromEntries((JSON.parse(body) as { needs: Array<{ id: string; state: string }> }).needs.map((n) => [n.id, n.state]));

/** Each setting given: the settings' own parser keeps only those it knows, so a new key is missing here until it is added. */
const EVERY_SETTING = parseSettings({ instance: "host", port: 8794, dataDir: "/d", appIdentityKeyFile: "/a", adapterKeyFile: "/k", instanceFactsFile: "/f",
  sources: { topics: [{ name: "notes", kind: "markdown", root: "/r", include: ["*.md"] }] }, scorer: { command: ["s"] }, shortlist: { operator: "12345" },
  draft: { writer: { command: ["w"] } }, publish: { repoDir: "/p", repo: "o/r" } }) as Required<GhostpenSettings>;

describe("the need of each setting", () => {
  it("names a need for every setting, so a new setting cannot go unchecked", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "src", "settings.ts"), "utf8");
    const body = /export interface GhostpenSettings \{([\s\S]*?)\n\}/u.exec(text)![1]!;
    const keys = [...body.matchAll(/^ {2}(?:readonly )?(\w+)\??:/gmu)].map(([, key]) => key!).sort();
    expect(keys.length).toBe(11);
    expect(Object.keys(NEED_OF_SETTING).sort()).toEqual(keys);
    expect(Object.keys(EVERY_SETTING).sort()).toEqual(keys);
    for (const id of Object.values(NEED_OF_SETTING)) expect(NEEDS.map((need) => need.id)).toContain(id);
  });

  it("has the 9 ids chatter files incidents under, the four the install writes required", () => {
    expect(NEEDS.map(({ id, kind }) => `${kind} ${id}`)).toEqual(["setting settings-file", "setting data-dir", "setting app-identity", "setting adapter-key",
      "setting channel", "source topic-sources", "source glossaries", "source published-posts", "setting scorer"]);
    expect(NEEDS.filter((need) => need.required).map((need) => need.id)).toEqual(["settings-file", "data-dir", "app-identity", "adapter-key"]);
    expect(NEEDS.filter((need) => need.spends !== "none").map(({ id, spends }) => `${id} ${spends}`)).toEqual(["scorer usage"]);
    for (const need of NEEDS) if (need.required) expect(need.fix).toBe("Run ghostpen's install for this instance through Relay; it writes this.");
  });

  it("leaves nothing a switch-on would refuse on what the install writes, and what spends off", async () => {
    const { needs } = await installed().list();
    expect(needs.filter((need) => need.required && need.state !== "working")).toEqual([]);
    expect(needs.filter((need) => need.spends === "usage").map((need) => need.state)).toEqual(["chosen_off"]);
  });
});

describe("GET /readiness", () => {
  it("answers over real HTTP, with no key, a list chatter takes whole, holding no setting's value", async () => {
    const secret = tempDir(), unique = (name: string) => join(secret, `private-${name}-ZQX`);
    const world = installed({ instanceFactsFile: unique("facts"), scorer: { command: [unique("scorer")] },
      sources: { topics: [{ name: "notes", kind: "markdown", root: unique("root"), include: ["*.md"] },
        { name: "repos", kind: "github", repos: ["o/r"], incidentLabel: "incident", measuredPattern: "x", tokenFile: unique("token") }],
      references: [{ name: "parts", kind: "glossary", root: unique("glossary"), include: ["*.md"] }], published: { blogDir: unique("blog"), baseUrl: "https://blog.example/private-QQ" } },
      shortlist: { operator: "55566677788" }, draft: { writer: { command: [unique("writer")] }, styleGuide: unique("style") },
      publish: { repoDir: unique("repo"), repo: "owner-private/blog-private", reviewCommand: [unique("review")] } });
    writeFileSync(join(world.dataDir, RANKING_FILE), JSON.stringify({ ranAt: "2026-10-26T00:00:00.000Z", entries: [], background: [], owed: [],
      problems: [`notes: ${unique("doc")} cannot be read`, `scorer: x: ${unique("scored")}`] }));
    saveShortlists(world.dataDir, { version: 1, weeks: { "2026-10-26": { madeAt: "2026-10-26T09:00:00.000Z", items: [
      { id: "a", kind: "decision", text: "A", draft: { status: "error", round: 1, at: "2026-10-26T10:00:00.000Z", problem: `the pull request could not be opened: git output ${unique("git")}` } }] } } });
    const { status, type, body } = await asked(await started(world.file));
    expect([status, type]).toEqual([200, "application/json; charset=utf-8"]);
    expect(faults(body)).toEqual([]);
    expect((JSON.parse(body) as { needs: unknown[] }).needs.length).toBe(9);
    for (const value of [secret, "ZQX", "private", world.dataDir, world.config, world.file, "55566677788", KEY_TEXT, ADAPTER_KEY.toString("base64url")]) {
      expect(body).not.toContain(value);
    }
    expect(statesOf(body)).toMatchObject({ "topic-sources": "failing", glossaries: "failing", "published-posts": "failing", scorer: "failing", channel: "failing" });
  });

  it("writes nothing in the data folder: the same entries, sizes and times after a read", async () => {
    const world = installed({ shortlist: { operator: "12345", channel: "67890" }, scorer: { command: ["sh"] }, draft: { writer: { command: ["sh"] } },
      sources: { topics: [{ name: "notes", kind: "markdown", root: tempDir(), include: ["*.md"] }] } });
    writeFileSync(join(world.dataDir, RANKING_FILE), JSON.stringify({ ranAt: new Date().toISOString(), entries: [], background: [], owed: [], problems: [] }));
    saveShortlists(world.dataDir, { version: 1, weeks: {} });
    mkdirSync(join(world.dataDir, "drafts"));
    const port = await started(world.file), before = snapshot(world.dataDir);
    expect((await asked(port)).status).toBe(200);
    expect(snapshot(world.dataDir)).toEqual(before);
  });

  it("sees the kept settings file change while the service runs", async () => {
    const world = installed(), port = await started(world.file);
    expect(statesOf((await asked(port)).body)).toMatchObject({ "settings-file": "working", "app-identity": "working", "adapter-key": "working" });
    writeFileSync(world.file, "not json");
    expect(statesOf((await asked(port)).body)["settings-file"]).toBe("failing");
  });

  it("leaves /health and the unkeyed adapter routes as they were, and answers only GET", async () => {
    const world = installed(), port = await started(world.file);
    expect(JSON.parse((await asked(port, "/health")).body)).toEqual({ ok: true, instance: "personal-comms-host", version: "0.1.0" });
    expect(await asked(port, "/v1/adapter/shortlist")).toMatchObject({ status: 404, body: JSON.stringify({ error: "not found" }) });
    expect((await asked(port, READINESS_PATH, "POST")).status).toBe(404);
  });

  it("is no route on a server given nothing to read", async () => {
    const server = createGhostpenServer({ instance: "host", dataDir: tempDir() });
    running.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    expect((await asked((server.address() as AddressInfo).port)).status).toBe(404);
  });

  it("stays under 64 KiB with every line at its longest", async () => {
    const { needs } = await installed().list();
    const full = needs.map((need) => ({ ...need, label: "l".repeat(80), why: "w".repeat(300), fix: "f".repeat(300), expected_by: need.since }));
    expect(Buffer.byteLength(JSON.stringify({ version: 1, needs: full }))).toBeLessThan(64 * 1024);
    expect(faults(JSON.stringify({ version: 1, needs }))).toEqual([]);
  });
});

describe("one bad need", () => {
  const settings = parseSettings({ instance: "host", port: 8794, dataDir: "/nowhere" });
  const facts: Facts = { settings, settingsFile: undefined, appKey: undefined, adapterKey: undefined, now: after(MINUTE), started: STARTED,
    ranking: rankingOnce("/nowhere") };
  const need = (check: Need["check"]): Need => ({ id: "bad", label: "Bad", kind: "source", required: false, spends: "none", fix: "x", check });

  it("reads failing when its check throws, saying nothing of the error", async () => {
    await expect(reading(need(() => { throw new Error("EACCES '/home/someone/secret'"); }), facts)).resolves.toMatchObject({ state: "failing", why: "this could not be checked" });
    await expect(reading(need(() => Promise.reject(new Error("later /x"))), facts)).resolves.toMatchObject({ state: "failing", why: "this could not be checked" });
  });

  it("gives up on a need after 4 s, before chatter gives up on the list at 5 s, and the list keeps every need", async () => {
    vi.useFakeTimers();
    try {
      const read = reading(need(() => new Promise(() => undefined)), facts);
      await vi.advanceTimersByTimeAsync(NEED_LIMIT_MS - 1);
      expect(await Promise.race([read, Promise.resolve(undefined)])).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(await read).toMatchObject({ state: "failing", why: "this did not answer within 4 s" });
    } finally { vi.useRealTimers(); }
    const { needs } = await readinessList({ settings, started: STARTED, now: () => after(MINUTE) });
    expect(needs.length).toBe(9);
    expect(faults(JSON.stringify({ version: 1, needs }))).toEqual([]);
  });

  it("says no path or address in a reason or a fix, and keeps one line of at most 300 characters", async () => {
    const read = await reading(need(() => ({ state: "failing", why: "no /home/someone/key at https://nas.local/x", since: STARTED.toISOString(), fix: "Repair /home/someone/key" })), facts);
    expect(read).toMatchObject({ why: "no [path] at [address]", fix: "Repair [path]" });
    expect(line(`a\nb\u0007${"c".repeat(400)}`)).toBe(`a b ${"c".repeat(296)}`);
    expect(line(" \n\t")).toBe("no reason was given");
  });
});
