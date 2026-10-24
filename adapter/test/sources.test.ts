import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSources } from "../src/sources/config.js";
import { readGithubTopics } from "../src/sources/github.js";
import { readGlossaries, readMarkdownTopics } from "../src/sources/markdown.js";
import { buildPublishedIndex, frontmatter, INDEX_FILE, postsAbout } from "../src/sources/published.js";
import { tempDir } from "./helpers.js";

function tree(files: Record<string, string>): string {
  const root = tempDir();
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the sources settings", () => {
  it("reads topic, reference and published sources, and names the field that is wrong", () => {
    const parsed = parseSources({
      topics: [{ name: "decisions", kind: "markdown", root: "/o/products", include: ["*/decisions/**/*.md"] },
        { name: "experiments", kind: "markdown", root: "/o/exp", include: ["*.md"], as: "experiment" },
        { name: "gh", kind: "github", repos: ["tyu41275/Relay"], incidentLabel: "incident", measuredPattern: "before.*after" }],
      references: [{ name: "glossaries", kind: "glossary", root: "/o/products", include: ["*/docs/CONTEXT.md"] }],
      published: { blogDir: "/blog/data/blog", baseUrl: "https://example.com/" } });
    expect(parsed.topics.map((t) => [t.name, t.kind])).toEqual([["decisions", "markdown"], ["experiments", "markdown"], ["gh", "github"]]);
    expect(parsed.topics[0]).toMatchObject({ as: "decision" });
    expect(parsed.topics[2]).toMatchObject({ days: 60 });
    expect(parsed.published).toEqual({ blogDir: "/blog/data/blog", baseUrl: "https://example.com" });
    expect(parseSources(undefined)).toEqual({ topics: [], references: [] });
    const md = { name: "a", kind: "markdown", root: "/r", include: ["*.md"] };
    for (const [raw, why] of [[{ topics: [{ ...md, root: "rel" }] }, "sources.topics[0].root must be an absolute path"],
      [{ topics: [{ ...md, include: ["../x/*.md"] }] }, "patterns must stay inside root"],
      [{ topics: [{ ...md, kind: "rss" }] }, "kind must be markdown or github"],
      [{ topics: [{ name: "g", kind: "github", repos: ["nope"], incidentLabel: "i", measuredPattern: "x" }] }, "owner/repo names"],
      [{ topics: [{ name: "g", kind: "github", repos: ["a/b"], incidentLabel: "i", measuredPattern: "(" }] }, "regular expression"],
      [{ topics: [md, md] }, "names must be unique"], [{ published: { blogDir: "/b", baseUrl: "ftp://x" } }, "baseUrl must be a web address"]] as const) {
      expect(() => parseSources(raw)).toThrow(why);
    }
  });
});

describe("markdown sources", () => {
  it("reads each matching document with its title and every line, located by file", () => {
    const root = tree({ "chatter/decisions/adr/0030.md": "# ADR 0030: optional adapters\n\n1. **Off unless allowed.**\n",
      "chatter/decisions/vision-briefs/b.md": "no heading here\n", "chatter/docs/CONTEXT.md": "# glossary\n" });
    const read = readMarkdownTopics({ name: "decisions", kind: "markdown", root, include: ["*/decisions/**/*.md"], as: "decision" });
    expect(read.problems).toEqual([]);
    expect(read.items.map((d) => [d.id, d.title, d.kind])).toEqual([
      ["decisions:chatter/decisions/adr/0030.md", "ADR 0030: optional adapters", "decision"], ["decisions:chatter/decisions/vision-briefs/b.md", "b", "decision"]]);
    expect(read.items[0]!.lines[2]).toBe("1. **Off unless allowed.**");
    expect(read.items[0]!.location).toEqual({ path: join(root, "chatter/decisions/adr/0030.md"), line: 1 });
  });

  it("names a missing folder, a pattern that matches nothing and a link out of the folder, never returning a silent empty", () => {
    expect(readMarkdownTopics({ name: "gone", kind: "markdown", root: "/nonexistent/x", include: ["*.md"], as: "decision" }))
      .toEqual({ items: [], problems: [{ source: "gone", problem: "its folder /nonexistent/x cannot be read" }] });
    const root = tree({ "a.md": "# A\n" });
    const outside = tree({ "secret.md": "# secret\n" });
    symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
    const read = readMarkdownTopics({ name: "s", kind: "markdown", root, include: ["*.md", "nothing/*.md"], as: "experiment" });
    expect(read.items.map((d) => d.title)).toEqual(["A"]);
    expect(read.problems).toEqual([{ source: "s", problem: "link.md leads outside its folder" },
      { source: "s", problem: "its pattern nothing/*.md matches no file" }]);
  });

  it("reads each glossary term with its text and the line of its heading", () => {
    const root = tree({ "chatter/docs/CONTEXT.md": "# chatter glossary\n\nIntro.\n\n## Task\nAn AI helper that does one job.\n**Not to be confused with:** a run.\n\n## Empty\n\n## Run\nOne attempt.\n# end\nnot part\n" });
    const read = readGlossaries({ name: "g", kind: "glossary", root, include: ["*/docs/CONTEXT.md"] });
    expect(read.items.map((d) => [d.term, d.text, d.location.line])).toEqual([
      ["Task", "An AI helper that does one job.\n**Not to be confused with:** a run.", 5], ["Run", "One attempt.", 11]]);
  });
});

describe("GitHub as a topic source", () => {
  const source = { name: "gh", kind: "github" as const, repos: ["o/r"], incidentLabel: "incident", measuredPattern: "before.+after", days: 30 };
  const NOW = new Date("2026-10-24T00:00:00Z");
  it("takes labelled issues (never PRs listed among them) and recent merged PRs that report measured results", async () => {
    const asked: string[] = [];
    const get = async (path: string) => {
      asked.push(path);
      if (path.startsWith("/repos/o/r/issues")) return [
        { number: 1, title: "/tmp filled", body: "ENOSPC\r\nfix", html_url: "https://github.com/o/r/issues/1", updated_at: "2026-10-24T00:00:00Z" },
        { number: 2, title: "a PR", pull_request: {}, updated_at: "2026-10-23T00:00:00Z" }];
      return [{ number: 3, title: "split tests", body: "before: 11 min, after: 4 min", merged_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" },
        { number: 4, title: "no numbers", body: "refactor", merged_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" },
        { number: 5, title: "old", body: "before x after y", merged_at: "2026-08-01T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" },
        { number: 6, title: "closed unmerged", body: "before x after y", merged_at: null, updated_at: "2026-10-19T00:00:00Z" }];
    };
    const read = await readGithubTopics(source, get, NOW);
    expect(read.problems).toEqual([]);
    expect(read.items.map((d) => [d.id, d.kind])).toEqual([["gh:o/r#1", "issue"], ["gh:o/r#3", "pull"]]);
    expect(read.items[0]!.lines).toEqual(["# /tmp filled", "", "ENOSPC", "fix"]);
    expect(read.items[1]!.location).toEqual({ url: "https://github.com/o/r/pull/3" });
    expect(asked[0]).toContain("labels=incident");
    expect(asked[0]).toContain("since=2026-09-24T00:00:00.000Z");
  });

  it("reports more results in the window than it reads, never dropping them silently", async () => {
    const full = (page: number) => Array.from({ length: 100 }, (_, i) => ({ number: page * 1000 + i, title: "t", body: "", labels: [],
      updated_at: "2026-10-23T00:00:00Z", html_url: "u" }));
    const read = await readGithubTopics(source, async (path) => full(Number(/page=(\d+)/u.exec(path)![1])), NOW);
    expect(read.items.filter((d) => d.kind === "issue")).toHaveLength(1000);
    expect(read.problems).toEqual([{ source: "gh", problem: "o/r has more issues in the last 30 days than the 1000 newest read" },
      { source: "gh", problem: "o/r has more pull requests in the last 30 days than the 1000 newest read" }]);
  });

  it("names a repository it cannot read, and still reads the others", async () => {
    const read = await readGithubTopics({ ...source, repos: ["o/down", "o/r"] }, async (path) => {
      if (path.startsWith("/repos/o/down")) throw new Error("GitHub answered 404");
      return [];
    }, NOW);
    expect(read).toEqual({ items: [], problems: [{ source: "gh", problem: "o/down cannot be read (GitHub answered 404)" }] });
  });
});

describe("the published-post index", () => {
  const post = (title: string, tags: string, body: string, draft = "false") =>
    `---\ntitle: '${title}'\ndate: '2026-03-16'\ntags: [${tags}]\ndraft: ${draft}\nsummary: "A summary"\n---\n\n${body}\n`;
  it("knows which posts are about a stack part and which only mention it, and keeps unchanged posts", () => {
    const blog = tree({ "2026-03-16-what-is-llm-router.mdx": post("What is llm-router", "'ai', 'llm-router'", "Uses chatter sometimes."),
      "2026-03-20-chatter.mdx": post("Meet Chatter", "'ai'", "It runs tasks."), "draft.mdx": post("Draft on chatter", "", "", "true"),
      "notes.txt": "ignored" });
    const data = tempDir();
    const source = { blogDir: blog, baseUrl: "https://example.com" };
    const { index, problems } = buildPublishedIndex(source, ["chatter", "llm-router", "Relay"], data);
    expect(problems).toEqual([]);
    expect(index.posts.map((p) => [p.file, p.about, p.mentions])).toEqual([
      ["2026-03-16-what-is-llm-router.mdx", ["llm-router"], ["chatter"]], ["2026-03-20-chatter.mdx", ["chatter"], []], ["draft.mdx", ["chatter"], []]]);
    expect(postsAbout(index, "Chatter").map((p) => p.url)).toEqual(["https://example.com/blog/2026-03-20-chatter"]); // never the draft
    expect(postsAbout(index, "relay")).toEqual([]);
    const stored = JSON.parse(readFileSync(join(data, INDEX_FILE), "utf8"));
    expect(stored.posts).toHaveLength(3);
    // An unchanged post keeps its stored entry; a changed one is read again.
    stored.posts[1].about = ["kept"];
    writeFileSync(join(data, INDEX_FILE), JSON.stringify(stored));
    writeFileSync(join(blog, "2026-03-16-what-is-llm-router.mdx"), post("What is llm-router", "'ai'", "no parts"));
    const again = buildPublishedIndex(source, ["chatter", "llm-router", "relay"], data).index;
    expect(again.posts[1]!.about).toEqual(["kept"]);
    expect(again.posts[0]!.about).toEqual(["llm-router"]); // still in the title
    expect(again.posts[0]!.mentions).toEqual([]);
    // A new blog address rebuilds every entry, so no stored post keeps the old host in its URL.
    const moved = buildPublishedIndex({ ...source, baseUrl: "https://new.example" }, ["chatter", "llm-router", "relay"], data).index;
    expect(moved.posts.map((p) => p.url.split("/blog/")[0])).toEqual(["https://new.example", "https://new.example", "https://new.example"]);
    expect(moved.posts[1]!.about).toEqual(["chatter"]); // the edited "kept" entry was not reused
  });

  it("names a post it cannot read and still indexes the rest", () => {
    const blog = tree({ "a.mdx": post("A on chatter", "", ""), "b.mdx": post("B", "", "") });
    chmodSync(join(blog, "b.mdx"), 0o000);
    try {
      if (process.getuid?.() === 0) return; // root reads anything
      const { index, problems } = buildPublishedIndex({ blogDir: blog, baseUrl: "https://x" }, ["chatter"], tempDir());
      expect(index.posts.map((p) => p.file)).toEqual(["a.mdx"]);
      expect(problems).toEqual([{ source: "published", problem: "the post b.mdx cannot be read" }]);
    } finally { chmodSync(join(blog, "b.mdx"), 0o644); }
  });

  it("names a blog folder it cannot read, and parses frontmatter lists and quotes", () => {
    expect(buildPublishedIndex({ blogDir: "/nonexistent/blog", baseUrl: "https://x" }, [], tempDir()).problems)
      .toEqual([{ source: "published", problem: "the blog folder /nonexistent/blog cannot be read" }]);
    expect(frontmatter("---\ntitle: \"A 'quoted' title\"\ntags: ['a', \"b\"]\n---\nbody").fields).toEqual({ title: "A 'quoted' title", tags: ["a", "b"] });
  });
});
