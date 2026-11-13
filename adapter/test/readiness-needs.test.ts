import { execFileSync } from "node:child_process";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RANKING_FILE } from "../src/ranking/run.js";
import { programProblem } from "../src/service/readiness-reading.js";
import { readinessList } from "../src/service/readiness.js";
import { after, bare, folder, installed, MINUTE, programIn, STARTED } from "./readiness-seed.js";
import { tempDir } from "./helpers.js";

const notRoot = process.getuid?.() !== 0;
afterEach(() => { vi.unstubAllEnvs(); });
const ranking = (dataDir: string, problems: string[]) =>
  writeFileSync(join(dataDir, RANKING_FILE), JSON.stringify({ ranAt: after(0).toISOString(), entries: [], background: [], owed: [], problems }));
const markdown = (root: string, name = "notes") => ({ name, kind: "markdown", root, include: ["*.md"] });

describe("settings-file", () => {
  it("reads working since the service started, and not_set_up with no file", async () => {
    expect(await installed().read("settings-file")).toMatchObject({ state: "working", since: STARTED.toISOString() });
    const world = installed();
    const { needs } = await readinessList({ settings: world.settings, started: STARTED, now: () => after(MINUTE) });
    expect(needs.find((need) => need.id === "settings-file")?.state).toBe("not_set_up");
  });

  it("reads failing on a file that is not JSON, quoting none of it, and on one gone", async () => {
    const world = installed();
    writeFileSync(world.file, "private-words-of-the-file");
    const read = await world.read("settings-file");
    expect(read).toMatchObject({ state: "failing", since: after(MINUTE).toISOString(), why: expect.stringContaining("not JSON") });
    expect(read.why).not.toContain("private");
    rmSync(world.file);
    expect(await world.read("settings-file")).toMatchObject({ state: "failing", why: expect.stringContaining("the file is missing") });
  });

  it("names the setting that fails its checks, never its value", async () => {
    const world = installed();
    writeFileSync(world.file, JSON.stringify({ ...world.settings, port: 77 }));
    const read = await world.read("settings-file");
    expect(read.why).toContain("port must be a whole number");
    expect(read.why).not.toContain("77");
  });

  it("says a changed file is not what the service runs on, and reads working again in any order", async () => {
    const world = installed();
    writeFileSync(world.file, JSON.stringify({ ...world.settings, instance: "other" }));
    expect(await world.read("settings-file")).toMatchObject({ state: "failing", why: expect.stringContaining("until it restarts"), fix: expect.stringContaining("Restart") });
    writeFileSync(world.file, JSON.stringify(Object.fromEntries(Object.entries(world.settings).reverse())));
    expect((await world.read("settings-file")).state).toBe("working");
  });

  it("reads failing at once on a pipe where the file belongs, which reading would block on", async () => {
    const world = installed();
    rmSync(world.file);
    execFileSync("mkfifo", [world.file]);
    expect(await world.read("settings-file")).toMatchObject({ state: "failing", why: expect.stringContaining("it is not a file") });
  });
});

describe("data-dir", () => {
  it("reads working, and failing on nothing there or a file", async () => {
    expect((await installed().read("data-dir")).state).toBe("working");
    expect(await bare({ dataDir: join(tempDir(), "gone") })("data-dir")).toMatchObject({ state: "failing", why: "dataDir: the folder is missing" });
    const file = join(tempDir(), "file");
    writeFileSync(file, "");
    expect(await bare({ dataDir: file })("data-dir")).toMatchObject({ state: "failing", why: "dataDir: it is not a folder" });
  });

  it.runIf(notRoot)("reads failing when it cannot be written", async () => {
    const world = installed();
    chmodSync(world.dataDir, 0o500);
    try { expect(await world.read("data-dir")).toMatchObject({ state: "failing", why: "dataDir: it cannot be used (EACCES)" }); } finally { chmodSync(world.dataDir, 0o700); }
  });
});

describe.each([["app-identity", "appIdentityKeyFile"], ["adapter-key", "adapterKeyFile"]] as const)("%s", (id, field) => {
  it("reads not_set_up with no setting, naming it", async () => {
    expect(await bare()(id)).toMatchObject({ state: "not_set_up", why: expect.stringContaining(field) });
  });

  it("reads failing on an empty, short or missing key, saying no path", async () => {
    const world = installed();
    for (const text of ["", "short\n"]) {
      writeFileSync(world[field], text);
      expect(await world.read(id)).toMatchObject({ state: "failing", why: `${field}: must hold base64url text of at least 32 bytes` });
    }
    rmSync(world[field]);
    expect(await world.read(id)).toMatchObject({ state: "failing", why: `${field}: the file is missing` });
  });

  it("says a good key that is not the one the service holds needs a restart", async () => {
    const world = installed();
    writeFileSync(world[field], `${"m".repeat(43)}\n`);
    expect(await world.read(id)).toMatchObject({ state: "failing", why: expect.stringContaining("until it restarts"), fix: expect.stringContaining("Restart") });
  });
});

describe("channel", () => {
  it("reads working on shortlist.channel, and not_set_up with neither setting", async () => {
    expect((await installed({ shortlist: { operator: "12345", channel: "67890" } }).read("channel")).state).toBe("working");
    expect(await installed().read("channel")).toMatchObject({ state: "not_set_up", why: expect.stringContaining("instanceFactsFile") });
  });

  it("reads chatter's instance facts: working with ghostpen's channel, failing without one, unreadable or gone", async () => {
    const facts = join(tempDir(), "instance-facts.json"), world = installed({ instanceFactsFile: facts });
    writeFileSync(facts, JSON.stringify({ adapterChannels: { ghostpen: { channelId: "67890" } } }));
    expect((await world.read("channel")).state).toBe("working");
    writeFileSync(facts, JSON.stringify({ adapterChannels: { tempo: { channelId: "1" } } }));
    expect(await world.read("channel")).toMatchObject({ state: "failing", fix: expect.stringContaining("Adapters page") });
    writeFileSync(facts, "private {");
    expect(await world.read("channel")).toMatchObject({ state: "failing", why: "instanceFactsFile: it is not JSON" });
    rmSync(facts);
    expect(await world.read("channel")).toMatchObject({ state: "failing", why: "instanceFactsFile: the file is missing" });
  });
});

describe("topic-sources", () => {
  it("reads not_set_up with none, working on folders that read", async () => {
    expect((await installed().read("topic-sources")).state).toBe("not_set_up");
    expect(await installed({ sources: { topics: [markdown(folder())] } }).read("topic-sources")).toMatchObject({ state: "working", why: "1 topic source can be read" });
  });

  it("names each setting that cannot be read, and counts the rest", async () => {
    const token = { name: "repos", kind: "github", repos: ["o/r"], incidentLabel: "incident", measuredPattern: "x", tokenFile: join(tempDir(), "gone") };
    const world = installed({ sources: { topics: [markdown(join(tempDir(), "gone")), token] } });
    expect(await world.read("topic-sources")).toMatchObject({ state: "failing", why: "sources.topics[0].root: the folder is missing (and 1 more)" });
    expect(await installed({ sources: { topics: [markdown(folder()), token] } }).read("topic-sources"))
      .toMatchObject({ state: "failing", why: "sources.topics[1].tokenFile: the file is missing" });
  });

  it("counts the last ranking's problems with the topic sources, quoting none", async () => {
    const world = installed({ sources: { topics: [markdown(folder())] } });
    ranking(world.dataDir, ["notes: /private/a.md cannot be read", "notes: /private/b.md cannot be read", "scorer: x: no", "parts: other"]);
    const read = await world.read("topic-sources");
    expect(read).toMatchObject({ state: "failing", since: after(0).toISOString(), why: `the last ranking, at ${after(0).toISOString()}, has 2 problems reading the topic sources` });
  });
});

describe("glossaries and published-posts", () => {
  it("read not_set_up with none, working on folders that read, failing naming the setting", async () => {
    expect((await installed().read("glossaries")).state).toBe("not_set_up");
    expect((await installed().read("published-posts")).state).toBe("not_set_up");
    const glossary = (root: string) => ({ name: "parts", kind: "glossary", root, include: ["*.md"] });
    expect((await installed({ sources: { references: [glossary(folder())] } }).read("glossaries")).state).toBe("working");
    expect(await installed({ sources: { references: [glossary(folder()), glossary(join(tempDir(), "gone"))].map((g, i) => ({ ...g, name: `p${i}` })) } }).read("glossaries"))
      .toMatchObject({ state: "failing", why: "sources.references[1].root: the folder is missing" });
    const published = (blogDir: string) => ({ sources: { published: { blogDir, baseUrl: "https://blog.example" } } });
    expect((await installed(published(folder())).read("published-posts")).state).toBe("working");
    expect(await installed(published(join(tempDir(), "gone"))).read("published-posts")).toMatchObject({ state: "failing", why: "sources.published.blogDir: the folder is missing" });
  });
});

describe("scorer", () => {
  it("is chosen off with none, working on a program that runs, by path or on PATH", async () => {
    expect((await installed().read("scorer")).state).toBe("chosen_off");
    expect((await installed({ scorer: { command: [join(programIn("score"), "score"), "--fast"] } }).read("scorer")).state).toBe("working");
    vi.stubEnv("PATH", programIn("score"));
    expect((await installed({ scorer: { command: ["score"] } }).read("scorer")).state).toBe("working");
    expect(await installed({ scorer: { command: ["nothing-by-this-name"] } }).read("scorer")).toMatchObject({ state: "failing", why: "scorer.command[0]: it is not found on PATH" });
  });

  it("reads failing on a program missing, a folder, or one that cannot run", async () => {
    expect(await installed({ scorer: { command: [join(tempDir(), "gone")] } }).read("scorer")).toMatchObject({ why: "scorer.command[0]: the file is missing" });
    expect(await installed({ scorer: { command: [tempDir()] } }).read("scorer")).toMatchObject({ why: "scorer.command[0]: it is not a file" });
    if (notRoot) expect(await programProblem(join(programIn("score", 0o644), "score"))).toBe("it cannot be run");
  });

  it("counts the last ranking's scorer failures", async () => {
    const world = installed({ scorer: { command: [join(programIn("score"), "score")] } });
    ranking(world.dataDir, ["scorer: a: /private/x timed out", "notes: other"]);
    expect(await world.read("scorer")).toMatchObject({ state: "failing", why: `the last ranking, at ${after(0).toISOString()}, has 1 scorer failure` });
  });
});
