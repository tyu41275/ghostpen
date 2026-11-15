import { describe, expect, it } from "vitest";
import { checkDraft } from "../src/draft/checks.js";
import { checkLinks, LINKS_CHECK, postLinks, type LinksContext } from "../src/draft/links.js";
import { buildPublishedIndex } from "../src/sources/published.js";
import { readServed, withServed } from "../src/sources/served.js";
import { tempDir, tree } from "./helpers.js";

const BASE = "https://blog.example";
const sitemap = (paths: string[]) => `<urlset>${paths.map((p) => `<url><loc>https://starter.example${p}</loc></url>`).join("")}</urlset>`;
const post = (extra = "") => `---\ntitle: 'A post'\ndate: '2026-01-01'\n${extra}---\nBody.\n`;

/** A blog with a live post, a draft, and a post the build dropped (its empty lastmod), and the sitemap's answer. */
async function blog(status = 200): Promise<LinksContext & { baseUrl: string }> {
  const source = { blogDir: tree({ "live.mdx": post(), "unready.mdx": post("draft: true\n"), "dropped.mdx": post("lastmod: ''\n") }), baseUrl: BASE };
  const served = await readServed(source, async () => ({ status, text: sitemap(["/", "/blog/live"]) }));
  return { baseUrl: BASE, served, index: withServed(buildPublishedIndex(source, [], tempDir()).index, served) };
}

describe("the draft's post links", () => {
  it("finds links to the blog's posts by path or the blog's address, outside code, each once", () => {
    const markdown = ["[a](/blog/live) and [b](https://blog.example/blog/live/) and [c](/blog/x#part) and [d](/blog/y?ref=1).",
      '<a href="/blog/jsx">j</a> and `[e](/blog/inline)`', "```", "[f](/blog/fenced)", "```",
      "[g](https://other.example/blog/z) [h](/tags/ai) [i](/blog/page/2) [k](/blog) [l](/about)"].join("\n");
    expect(postLinks(markdown, BASE)).toEqual(["/blog/live", "/blog/x", "/blog/y", "/blog/jsx"]);
    expect(postLinks("[b](https://blog.example/blog/live)")).toEqual([]); // no blog configured: its address is another site's
  });

  it("passes a draft whose post links all lead to a post the blog serves", async () => {
    expect(checkLinks("See [this](/blog/live) and [that](https://blog.example/blog/live/#part).", await blog())).toEqual({ passed: true, findings: [], unknown: false });
  });

  it("names a link to no post, to a draft, and to a post the site does not serve", async () => {
    expect(checkLinks("[a](/blog/gone) [b](/blog/unready) [c](/blog/dropped)", await blog())).toEqual({ passed: false, unknown: false, findings: [
      "the link /blog/gone leads to no post: take it out or link a post that is on the blog",
      "the link /blog/unready leads to a draft: it is not on the blog yet",
      "the link /blog/dropped leads to a post the site does not serve: its build left it out, or it is not deployed yet"] });
  });

  it("cannot check a post link with the sitemap unread or no blog configured, and passes a draft with no post link", async () => {
    const down = await blog(503);
    expect(checkLinks("[a](/blog/live) [b](/blog/gone)", down)).toEqual({ passed: false, unknown: true, findings: [
      "the link /blog/live cannot be checked: the blog's sitemap answered 503",
      "the link /blog/gone leads to no post: take it out or link a post that is on the blog"] });
    expect(checkLinks("No post links. [x](https://other.example/blog/a) [y](/tags/ai)", down)).toEqual({ passed: true, findings: [], unknown: false });
    expect(checkLinks("[a](/blog/live)", { index: down.index })).toEqual({ passed: false, unknown: true,
      findings: ["the link /blog/live cannot be checked: sources.published is not set"] });
  });

  it("shows five findings and counts the rest", async () => {
    const findings = checkLinks([1, 2, 3, 4, 5, 6, 7].map((n) => `[p](/blog/gone-${n})`).join(" "), await blog()).findings;
    expect(findings).toHaveLength(6);
    expect(findings.at(-1)).toBe("2 more links do not work");
  });

  it("is the draft's fourth check, and an unread sitemap marks the report as one rewording cannot fix", async () => {
    const draft = { title: "Notes", markdown: "We had a choice. We picked one. See [the post](/blog/dropped)." };
    const failed = checkDraft(draft, { terms: [], graph: null, ...(await blog()) });
    expect(failed.checks.map((c) => [c.name, c.passed])[3]).toEqual([LINKS_CHECK, false]);
    expect(failed.unknown).toBeUndefined();
    expect(checkDraft(draft, { terms: [], graph: null, ...(await blog(503)) }).unknown).toBe(true);
  });
});
