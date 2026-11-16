/**
 * The root blog in real Chromium, both ways it builds: from content-sample/ (GHOSTPEN_CONTENT_DIR) the home page shows
 * site.json's generic profile and a post's footer its links, nothing of the legacy intro; without the variable (legacy)
 * they show components/LegacyIntro.tsx and components/LegacyPostLinks.tsx. The legacy values are read from those files,
 * so no person's name or account is written here. scripts/build-e2e-sites.sh builds the two sites first.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const first = (src: string, re: RegExp) => { const m = re.exec(src); if (!m?.[1]) throw new Error(`${re} matches nothing`); return m[1].trim(); };
const intro = read("components/LegacyIntro.tsx");
const LEGACY = { alt: first(intro, /alt="([^"]+)"/u), name: first(intro, /<h2[^>]*>([^<]+)<\/h2>/u), role: first(intro, /<p[^>]*>([^<{]+)<\/p>/u),
  hrefs: [...intro.matchAll(/href="([^"]+)"/gu)].map((m) => m[1]!) };
const postLinks = read("components/LegacyPostLinks.tsx");
const LEGACY_POST = { hrefs: [...postLinks.matchAll(/href="([^"]+)"/gu)].map((m) => m[1]!), howItWorksSlug: first(postLinks, /slug !== '([^']+)'/u) };
const SAMPLE = JSON.parse(read("content-sample/site.json")).home as { avatar: string; sourceRepo: string; howItWorks: string };
// A published, AI-written legacy post other than the "How it works" one: its footer carries both links.
const legacyPost = readdirSync(join(ROOT, "data/blog")).filter((f) => f.endsWith(".mdx")).sort().map((f) => f.slice(0, -4))
  .find((slug) => { const src = read(`data/blog/${slug}.mdx`); return slug !== LEGACY_POST.howItWorksSlug && /^aiGenerated: true$/mu.test(src) && !/^draft: true$/mu.test(src); });

const servers: ChildProcess[] = [];
const origins: Record<string, string> = {};
let browser: Browser;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** `next start` on one built site; resolves with its origin once it answers. */
async function serve(distDir: string): Promise<string> {
  if (!existsSync(join(ROOT, distDir, "BUILD_ID"))) throw new Error(`${distDir}/ is not built: run scripts/build-e2e-sites.sh from the repository root first`);
  const port = await freePort();
  // GHOSTPEN_CONTENT_PREPARED: the server must not rebuild .content/ or public/'s images under the other one.
  const child = spawn(join(ROOT, "node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"],
    { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GHOSTPEN_DIST_DIR: distDir, GHOSTPEN_CONTENT_PREPARED: "1" } });
  servers.push(child);
  let log = "";
  child.stdout?.on("data", (d) => { log += d; });
  child.stderr?.on("data", (d) => { log += d; });
  const origin = `http://127.0.0.1:${port}`;
  for (const deadline = Date.now() + 50_000; Date.now() < deadline;) {
    if (child.exitCode !== null) break;
    if (await fetch(origin).then((r) => r.ok, () => false)) return origin;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`next start for ${distDir} did not answer:\n${log}`);
}

beforeAll(async () => {
  [origins.sample, origins.legacy] = await Promise.all([serve(".next-e2e-sample"), serve(".next-e2e-legacy")]);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await Promise.all(servers.map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || !child.pid) return resolve();
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    process.kill(-child.pid, "SIGTERM"); // its own process group (detached), never a searched-for PID
  })));
});

async function open(site: string, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  expect((await page.goto(origins[site] + path))?.status()).toBe(200);
  return page;
}

/** Waits for the picture to load and returns where it came from, decoded (next/image serves it through /_next/image). */
async function loaded(img: Locator): Promise<string> {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: { complete: boolean; naturalWidth: number }) => (el.complete ? el.naturalWidth : 0)), { timeout: 10_000 }).toBeGreaterThan(0);
  return decodeURIComponent(await img.evaluate((el: { currentSrc: string }) => el.currentSrc));
}

const word = (text: string) => new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
const footer = (page: Page) => page.getByText(/^Written by/u);

describe("the blog built from content-sample/", () => {
  it("shows the sample profile on the home page and nothing of the legacy intro", async () => {
    const page = await open("sample", "/");
    await expect.poll(() => page.locator("h2", { hasText: "Sample Author" }).count()).toBe(1);
    expect(await page.getByText("Writes the sample posts", { exact: true }).count()).toBe(1);
    expect(await page.getByRole("link", { name: "GitHub", exact: true }).count()).toBe(1);
    expect(await loaded(page.locator('img[alt="Sample Author"]'))).toContain(SAMPLE.avatar);
    const text = await page.locator("body").innerText();
    for (const value of [LEGACY.alt, LEGACY.name, LEGACY.role]) expect(text).not.toMatch(word(value));
    for (const href of LEGACY.hrefs.filter((h) => h.startsWith("http") || h.startsWith("/blog/"))) expect(await page.locator(`a[href="${href}"]`).count()).toBe(0);
  });

  it("links a post's footer to the sample's source and How it works, and shows its picture", async () => {
    const page = await open("sample", "/blog/a-post-with-a-picture");
    expect(await footer(page).getByRole("link", { name: "Ghostpen" }).getAttribute("href")).toBe(SAMPLE.sourceRepo);
    expect(await footer(page).getByRole("link", { name: "How it works" }).getAttribute("href")).toBe(SAMPLE.howItWorks);
    for (const href of LEGACY_POST.hrefs) expect(await page.locator(`a[href="${href}"]`).count()).toBe(0);
    expect(await loaded(page.locator('img[alt="The sample picture"]'))).toContain("/static/images/sample/logo.png");
  });

  it("counts the sample's tags in the blog list (Contentlayer's onSuccess wrote them)", async () => {
    const page = await open("sample", "/blog");
    expect(await page.getByRole("link", { name: "View posts tagged sample" }).innerText()).toMatch(/^sample \(2\)$/iu);
    expect(await page.getByRole("link", { name: "View posts tagged ai" }).innerText()).toMatch(/^ai \(1\)$/iu);
  });

  it("leaves How it works off the How it works post itself", async () => {
    const page = await open("sample", SAMPLE.howItWorks);
    expect(await footer(page).getByRole("link", { name: "Ghostpen" }).getAttribute("href")).toBe(SAMPLE.sourceRepo);
    expect(await footer(page).getByRole("link", { name: "How it works" }).count()).toBe(0);
  });
});

describe("the blog built from the repository's own content (legacy)", () => {
  it("shows the legacy intro on the home page", async () => {
    const page = await open("legacy", "/");
    expect(await page.locator("h2", { hasText: LEGACY.name }).first().innerText()).toBe(LEGACY.name);
    expect(await page.getByText(LEGACY.role, { exact: true }).count()).toBe(1);
    expect(await loaded(page.locator(`img[alt="${LEGACY.alt}"]`))).toContain("/static/images/avatar.png");
    for (const href of LEGACY.hrefs) expect(await page.locator(`a[href="${href}"]`).count(), href).toBeGreaterThan(0);
    expect(await page.locator("body").innerText()).not.toContain("Sample Author");
  });

  it("gives a post's footer the legacy links, without How it works on that post itself", async () => {
    expect(legacyPost, "an AI-written legacy post in data/blog/").toBeTruthy();
    const page = await open("legacy", `/blog/${legacyPost}`);
    expect(await footer(page).locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual(LEGACY_POST.hrefs);
    const own = await open("legacy", `/blog/${LEGACY_POST.howItWorksSlug}`);
    expect(await footer(own).locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual(LEGACY_POST.hrefs.slice(0, 1));
  });
});
