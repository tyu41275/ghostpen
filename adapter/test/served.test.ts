import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPublishedIndex, INDEX_FILE, postsAbout } from "../src/sources/published.js";
import { liveSitemapGet, readServed, withServed, type SitemapGet } from "../src/sources/served.js";
import { tempDir, tree } from "./helpers.js";

const SOURCE = { blogDir: "/unused", baseUrl: "https://blog.example" };
/** Next's sitemap as the blog serves it: every address on the starter's host (its `siteUrl`), not the blog's. */
const sitemap = (paths: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  paths.map((p) => `<url>\n<loc>https://tailwind-nextjs-starter-blog.vercel.app${p}</loc>\n<lastmod>2026-03-20</lastmod>\n</url>`).join("\n")}\n</urlset>`;
const answering = (status: number, text: string): SitemapGet => async () => ({ status, text });
const post = (title: string, extra = "") => `---\ntitle: '${title}'\ndate: '2026-03-16'\ntags: ['chatter']\n${extra}---\nBody.\n`;

describe("the blog's sitemap", () => {
  it("gives the paths it lists, by path only, from <baseUrl>/sitemap.xml", async () => {
    const asked: string[] = [];
    const served = await readServed(SOURCE, async (url) => { asked.push(url); return { status: 200, text: sitemap(["/", "/blog/a", "/blog/b/", "/blog/caf%C3%A9", "/tags/x"]) }; });
    expect(asked).toEqual(["https://blog.example/sitemap.xml"]);
    expect(served).toEqual({ paths: new Set(["/", "/blog/a", "/blog/b", "/blog/café", "/tags/x"]) });
  });

  it("says why when it cannot be read, never an empty list, and never names the address", async () => {
    const cases: Array<[SitemapGet, string]> = [
      [answering(404, sitemap(["/blog/a"])), "the blog's sitemap answered 404"],
      [answering(503, ""), "the blog's sitemap answered 503"],
      [async () => { throw new Error("fetch failed: https://blog.example/sitemap.xml"); }, "the blog's sitemap did not answer"],
      [answering(200, "<html><body>Sign in</body></html>"), "the blog's sitemap lists no posts"],
      [answering(200, "<sitemapindex><sitemap><loc>https://blog.example/posts.xml</loc></sitemap></sitemapindex>"), "the blog's sitemap lists no posts"],
      [answering(200, sitemap(["/", "/about"])), "the blog's sitemap lists no posts"]];
    for (const [get, problem] of cases) expect(await readServed(SOURCE, get)).toEqual({ problem });
  });

  it("reads the live sitemap over HTTP, and refuses one over 2 MB", async () => {
    const server = await serving((path) => (path === "/big/sitemap.xml" ? "x".repeat(2 * 1024 * 1024 + 1) : sitemap(["/blog/a"])));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await readServed({ ...SOURCE, baseUrl: base }, liveSitemapGet)).toEqual({ paths: new Set(["/blog/a"]) });
    expect(await readServed({ ...SOURCE, baseUrl: `${base}/big` }, liveSitemapGet)).toEqual({ problem: "the blog's sitemap is over 2 MB" });
  });
});

const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise((done) => { s.closeAllConnections(); s.close(done); }); });
async function serving(body: (path: string) => string): Promise<Server> {
  const server = createServer((req, res) => { res.writeHead(200, { "content-type": "application/xml" }); res.end(body(req.url ?? "/")); });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return server;
}

describe("served posts in the index", () => {
  it("marks each post in memory only, and leaves it unmarked when the sitemap was not read", async () => {
    const blog = tree({ "a.mdx": post("A on chatter"), "b.mdx": post("B on chatter") });
    const data = tempDir(), source = { blogDir: blog, baseUrl: "https://blog.example" };
    const first = withServed(buildPublishedIndex(source, ["chatter"], data).index, await readServed(source, answering(200, sitemap(["/blog/a"]))));
    expect(first.posts.map((p) => [p.file, p.served])).toEqual([["a.mdx", true], ["b.mdx", false]]);
    // The stored entries are kept by hash: served changes with no file changing, so it is never stored.
    expect(readFileSync(join(data, INDEX_FILE), "utf8")).not.toContain("served");
    const second = withServed(buildPublishedIndex(source, ["chatter"], data).index, await readServed(source, answering(200, sitemap(["/blog/b"]))));
    expect(second.posts.map((p) => [p.file, p.served])).toEqual([["a.mdx", false], ["b.mdx", true]]);
    const unread = withServed(buildPublishedIndex(source, ["chatter"], data).index, { problem: "the blog's sitemap answered 503" });
    expect(unread.posts.map((p) => p.served)).toEqual([undefined, undefined]);
  });

  it("drops a post the site does not serve from the posts about a part, and keeps it when the sitemap was not read", () => {
    const blog = tree({ "a.mdx": post("A on chatter"), "dropped.mdx": post("Dropped on chatter", "lastmod: ''\n"), "d.mdx": post("D on chatter", "draft: true\n") });
    const data = tempDir(), source = { blogDir: blog, baseUrl: "https://blog.example" };
    const index = buildPublishedIndex(source, ["chatter"], data).index;
    const about = (served: Parameters<typeof withServed>[1]) => postsAbout(withServed(index, served), "chatter").map((p) => p.file).sort();
    expect(about({ paths: new Set(["/blog/a"]) })).toEqual(["a.mdx"]);
    expect(about({ problem: "the blog's sitemap did not answer" })).toEqual(["a.mdx", "dropped.mdx"]);
  });
});
