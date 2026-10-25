import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writerPrompt } from "../src/draft/prompt.js";
import { parseScreenshots, privacyFindings, screenshotRefs, takeScreenshots, type Capture, type ScreenshotSettings } from "../src/draft/screenshots.js";
import { parseSettings } from "../src/settings.js";
import { tempDir } from "./helpers.js";

const SETTINGS: ScreenshotSettings = parseScreenshots({ pages: [{ name: "console", url: "http://127.0.0.1:8601/", description: "the operator console", mask: [".who"] },
  { name: "tempo", url: "https://tempo.example/", description: "Tempo's grades" }], private: ["\\bacme\\b"] });
const clean: Capture = { png: Buffer.from("PNG"), text: ["Tasks", "3 running"], unreadable: [] };
const fake = (by: Record<string, Capture | Error>) => async (page: { name: string }) => {
  const result = by[page.name] ?? clean;
  if (result instanceof Error) throw result;
  return result;
};

describe("screenshot settings", () => {
  it("reads pages with their defaults", () => {
    expect(SETTINGS.pages[0]).toEqual({ name: "console", url: "http://127.0.0.1:8601/", description: "the operator console", mask: [".who"], width: 1280, height: 800 });
    expect(SETTINGS.timeoutSeconds).toBe(30);
    const base = { instance: "i", port: 8794, dataDir: "/d" };
    expect(parseSettings({ ...base, draft: { writer: { command: ["w"] }, screenshots: { pages: [{ name: "a", url: "http://x/", description: "d" }] } } }).draft?.screenshots?.pages).toHaveLength(1);
  });

  it("refuses bad pages, patterns and limits, naming the field", () => {
    const page = { name: "a", url: "http://x/", description: "d" };
    for (const [raw, error] of [[[], " must be an object"], [{ pages: [] }, ".pages must list 1 to 20"], [{ pages: Array.from({ length: 21 }, (_, i) => ({ ...page, name: `p${i}` })) }, ".pages must list 1 to 20"], [{ pages: [page, page] }, ".pages[1].name must be a unique name"],
      [{ pages: [{ ...page, url: "file:///etc" }] }, ".pages[0].url must be a web address"], [{ pages: [{ ...page, description: " " }] }, ".pages[0].description must say"],
      [{ pages: [{ ...page, mask: [""] }] }, ".pages[0].mask must be a list of CSS selectors"], [{ pages: [{ ...page, width: 100 }] }, ".pages[0].width must be 320 to 3840"],
      [{ pages: [page], private: ["("] }, ".private[0] is not a valid pattern"], [{ pages: [page], timeoutSeconds: 1 }, ".timeoutSeconds must be 5 to 300"],
      [{ pages: [{ ...page, waitFor: "" }] }, ".pages[0].waitFor must be a CSS selector"]] as const) {
      expect(() => parseScreenshots(raw)).toThrow(`settings: draft.screenshots${error}`);
    }
  });
});

describe("privacy", () => {
  it("names each kind of private detail once, never the detail", () => {
    const found = privacyFindings(["mail tim@example.com", "from 10.0.0.12", "user 234652039735541760", "key sk-abcdefghijklmnopqrstuv",
      "at /home/someone/x", "Bearer abcdefghijkl", "ghp_abcdefghijklmnopqrstuvwxyz", "hello ACME team"], [/\bacme\b/iu]);
    expect(found).toEqual(["an email address", "an IP address", "a long id number", "a key or token", "a home folder path", "a word on the private list"]);
    expect(found.join(" ")).not.toContain("tim@");
    expect(privacyFindings(["3 tasks running", "Version 1.2.3", "2026-10-25 09:00"], [])).toEqual([]);
  });
});

describe("taking screenshots", () => {
  const md = "Look: ![the console with three tasks](screenshot:console) and ![](screenshot:tempo) again ![x](screenshot:console)";

  it("finds what a draft asks for", () => {
    expect(screenshotRefs(md)).toEqual([{ alt: "the console with three tasks", name: "console" }, { alt: "", name: "tempo" }, { alt: "x", name: "console" }]);
  });

  it("keeps a clean screenshot, once per page", async () => {
    const dir = join(tempDir(), "shots");
    let calls = 0;
    const result = await takeScreenshots("![the console](screenshot:console) ![again](screenshot:console)", SETTINGS, dir, async () => { calls += 1; return clean; });
    expect(result).toEqual({ passed: true, findings: [], files: { console: join(dir, "console.png") } });
    expect(calls).toBe(1);
    expect(readFileSync(join(dir, "console.png"), "utf8")).toBe("PNG");
  });

  it("fails closed: private text, unreadable content, an error, an unknown page or missing words keep no picture", async () => {
    const dir = join(tempDir(), "shots");
    const result = await takeScreenshots(md + " ![a](screenshot:nope) ![b](screenshot:gone)", { ...SETTINGS, pages: [...SETTINGS.pages, { ...SETTINGS.pages[1]!, name: "gone" }] }, dir,
      fake({ console: { ...clean, text: ["Signed in as tim@example.com"] }, tempo: { ...clean, unreadable: ["canvas", "canvas", "iframe"] }, gone: new Error("net::ERR_CONNECTION_REFUSED\nmore") }));
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      "screenshot console shows something private (an email address): mask it (settings.draft.screenshots.pages[].mask)",
      "screenshot tempo needs words saying what it shows",
      "screenshot tempo shows content that cannot be checked (canvas, iframe): mask it (settings.draft.screenshots.pages[].mask)",
      "screenshot nope is not a configured page (settings.draft.screenshots.pages)",
      "screenshot gone could not be taken: net::ERR_CONNECTION_REFUSED"]);
    expect(result.files).toEqual({});
    expect(existsSync(dir)).toBe(false);
  });

  it("checks the operator's own private words", async () => {
    const result = await takeScreenshots("![the console](screenshot:console)", SETTINGS, tempDir(), fake({ console: { ...clean, text: ["Acme rollout"] } }));
    expect(result.findings).toEqual(["screenshot console shows something private (a word on the private list): mask it (settings.draft.screenshots.pages[].mask)"]);
  });

  it("refuses every screenshot when no pages are configured", async () => {
    expect((await takeScreenshots("![a](screenshot:console)", undefined, tempDir(), fake({}))).findings).toEqual(["screenshot console is not a configured page (settings.draft.screenshots.pages)"]);
  });

  it("tells the writer which pages it may show, or none", () => {
    const brief = { kind: "decision" as const, subject: "s", documents: [], parts: [], graph: null, voice: [] };
    expect(writerPrompt({ ...brief, screenshots: [{ name: "console", description: "the operator console" }] }))
      .toContain("written `![<what it shows, in plain words>](screenshot:<name>)`:\n- console: the operator console");
    expect(writerPrompt(brief)).toContain("Add no screenshots or images.");
  });
});
