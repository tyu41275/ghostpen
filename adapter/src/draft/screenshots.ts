/**
 * Screenshots in drafts (ADR 0101, brief D11): the writer may place `![what it shows](screenshot:<name>)` for a page the
 * operator configured (`settings.draft.screenshots.pages`). Each is taken in a real browser with the page's `mask` selectors
 * painted over, and is kept only if the page's visible text outside the masks shows nothing private. The check fails
 * closed: a page that cannot be loaded, that holds content it cannot read (a canvas, a video, a frame) outside the masks,
 * or whose text matches a private pattern gives no screenshot, and the draft fails saying which kind of detail it saw,
 * never the detail itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ShotPage { name: string; url: string; description: string; mask: string[]; waitFor?: string; width: number; height: number }
export interface ScreenshotSettings { pages: ShotPage[]; private: string[]; timeoutSeconds: number }
/** What a page showed: the picture, its visible text outside the masks, and content whose text cannot be read. */
export interface Capture { png: Buffer; text: string[]; unreadable: string[] }
export type Capturer = (page: ShotPage, timeoutMs: number) => Promise<Capture>;
export interface ShotsResult { passed: boolean; findings: string[]; files: Record<string, string> }

/** Private details every screenshot is checked for, by kind; the operator adds their own (names, project words). */
export const PRIVATE_KINDS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: "an email address", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
  { kind: "an IP address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/u },
  { kind: "a long id number", pattern: /\b\d{15,20}\b/u },
  { kind: "a key or token", pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})|\bBearer\s+\S{8,}|[A-Za-z0-9_+/=-]{40,}/u },
  { kind: "a home folder path", pattern: /\/home\/[^\s/]+|\/Users\/[^\s/]+|[A-Za-z]:\\Users\\[^\s\\]+/u },
];

const NAME = /^[A-Za-z0-9_-]{1,40}$/u;
export const SHOT_REF = /!\[([^\]]*)\]\(screenshot:([^)\s]*)\)/gu;

/** The screenshots a draft asks for, in order. */
export const screenshotRefs = (markdown: string) => [...markdown.matchAll(SHOT_REF)].map((m) => ({ alt: m[1]!.trim(), name: m[2]! }));

/** The kinds of private detail in `texts`, each once; never the detail itself. */
export function privacyFindings(texts: string[], extra: RegExp[]): string[] {
  const kinds = [...PRIVATE_KINDS, ...extra.map((pattern) => ({ kind: "a word on the private list", pattern }))];
  return [...new Set(kinds.filter((k) => texts.some((t) => k.pattern.test(t))).map((k) => k.kind))];
}

export async function takeScreenshots(markdown: string, settings: ScreenshotSettings | undefined, dir: string, capture: Capturer): Promise<ShotsResult> {
  const findings: string[] = [];
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  const pictures = new Map<string, Buffer>();
  const extra = (settings?.private ?? []).map((p) => new RegExp(p, "iu"));
  for (const { alt, name } of screenshotRefs(markdown)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const page = settings?.pages.find((p) => p.name === name);
    if (!page) { findings.push(`screenshot ${name} is not a configured page (settings.draft.screenshots.pages)`); continue; }
    if (!alt) { findings.push(`screenshot ${name} needs words saying what it shows`); continue; }
    let shot: Capture;
    try { shot = await capture(page, settings!.timeoutSeconds * 1000); } catch (error) {
      findings.push(`screenshot ${name} could not be taken: ${error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : String(error)}`);
      continue;
    }
    if (shot.unreadable.length) {
      findings.push(`screenshot ${name} shows content that cannot be checked (${[...new Set(shot.unreadable)].join(", ")}): mask it (settings.draft.screenshots.pages[].mask)`);
      continue;
    }
    const found = privacyFindings(shot.text, extra);
    if (found.length) { findings.push(`screenshot ${name} shows something private (${found.join(", ")}): mask it (settings.draft.screenshots.pages[].mask)`); continue; }
    pictures.set(name, shot.png);
  }
  // All or nothing: one failing screenshot keeps none, so a failed draft leaves no picture behind.
  if (findings.length) return { passed: false, findings, files: {} };
  for (const [name, png] of pictures) {
    mkdirSync(dir, { recursive: true });
    files[name] = join(dir, `${name}.png`);
    writeFileSync(files[name]!, png);
  }
  return { passed: true, findings, files };
}

/** The real capture: Chromium through Playwright (loaded only when a screenshot is asked for). */
export const playwrightCapture: Capturer = async (page, timeoutMs) => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const tab = await (await browser.newContext({ viewport: { width: page.width, height: page.height } })).newPage();
    await tab.goto(page.url, { timeout: timeoutMs, waitUntil: "load" });
    if (page.waitFor) await tab.waitForSelector(page.waitFor, { timeout: timeoutMs });
    const seen = await tab.evaluate((selectors: string[]) => {
      const masked = selectors.flatMap((s) => [...document.querySelectorAll(s)]);
      const hidden = (el: Element) => masked.some((m) => m.contains(el)) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const text: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent && node.textContent?.trim() && !hidden(parent)) text.push(node.textContent.trim());
      }
      for (const field of document.querySelectorAll("input, textarea, select")) {
        const value = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.text ?? "" : (field as HTMLInputElement).value;
        if (value.trim() && !hidden(field)) text.push(value.trim());
      }
      const unreadable = [...document.querySelectorAll("canvas, video, iframe, embed, object")].filter((el) => !hidden(el)).map((el) => el.tagName.toLowerCase());
      return { text, unreadable };
    }, page.mask);
    const png = await tab.screenshot({ mask: page.mask.map((s) => tab.locator(s)), maskColor: "#808080" });
    return { png, ...seen };
  } finally {
    await browser.close();
  }
};

/** `screenshots`: `pages` (1 to 20: `name`, `url`, `description`, optional `mask`, `waitFor`, `width`, `height`), `private`, `timeoutSeconds`. */
export function parseScreenshots(raw: unknown): ScreenshotSettings {
  const fail = (what: string): never => { throw new Error(`settings: draft.screenshots${what}`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(" must be an object");
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 20) fail(".pages must list 1 to 20 pages");
  const names = new Set<string>();
  const pages = (value.pages as unknown[]).map((p, i): ShotPage => {
    const page = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const at = `.pages[${i}]`;
    if (typeof page.name !== "string" || !NAME.test(page.name) || names.has(page.name)) fail(`${at}.name must be a unique name (letters, digits, - and _)`);
    names.add(page.name as string);
    if (typeof page.url !== "string" || !/^https?:\/\/\S+$/u.test(page.url)) fail(`${at}.url must be a web address`);
    if (typeof page.description !== "string" || !page.description.trim()) fail(`${at}.description must say what the page shows`);
    const mask = page.mask ?? [];
    if (!Array.isArray(mask) || !mask.every((s) => typeof s === "string" && s.trim())) fail(`${at}.mask must be a list of CSS selectors`);
    if (page.waitFor !== undefined && (typeof page.waitFor !== "string" || !page.waitFor.trim())) fail(`${at}.waitFor must be a CSS selector`);
    const size = (v: unknown, field: string, fallback: number) => {
      const n = v ?? fallback;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 320 || n > 3840) fail(`${at}.${field} must be 320 to 3840`);
      return n as number;
    };
    return { name: page.name as string, url: page.url as string, description: (page.description as string).trim(), mask: mask as string[],
      ...(page.waitFor ? { waitFor: page.waitFor as string } : {}), width: size(page.width, "width", 1280), height: size(page.height, "height", 800) };
  });
  const extra = value.private ?? [];
  if (!Array.isArray(extra) || !extra.every((p) => typeof p === "string" && p !== "")) fail(".private must be a list of patterns");
  (extra as string[]).forEach((p, i) => { try { new RegExp(p, "iu"); } catch { fail(`.private[${i}] is not a valid pattern`); } });
  const timeout = value.timeoutSeconds ?? 30;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 5 || timeout > 300) fail(".timeoutSeconds must be 5 to 300");
  return { pages, private: extra as string[], timeoutSeconds: timeout as number };
}
