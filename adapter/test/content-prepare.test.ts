/**
 * The blog's content step (scripts/content.js, ghostpen#135): it builds `.content/` from the folder GHOSTPEN_CONTENT_DIR
 * names, or from the repository's data/ while the variable is unset, and copies a folder's images into
 * public/static/images/, removing only what it copied before. Each test runs it against its own temporary root.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Prepare = (options: { root: string; env: Record<string, string | undefined>; log?: (line: string) => void }) => {
  mode: string; dir: string; images: string[];
};
const { prepareContent } = createRequire(import.meta.url)("../../scripts/content.js") as { prepareContent: Prepare };

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ghostpen-content-"));
  made.push(dir);
  return dir;
}
function put(file: string, text: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
const SITE = { title: "A blog", author: "An Author", siteUrl: "https://blog.example.com" };

/** A content folder under `base` with the required files, and `images` (path -> bytes) under images/. */
function folder(base: string, name: string, images: Record<string, string> = {}, site: unknown = SITE): string {
  const dir = join(base, name);
  put(join(dir, "site.json"), JSON.stringify(site));
  put(join(dir, "authors", "default.mdx"), "---\nname: An Author\n---\n");
  put(join(dir, "blog", "nested", "post.mdx"), "---\ntitle: 'P'\ndate: '2026-01-01'\n---\nBody.\n");
  for (const [rel, bytes] of Object.entries(images)) put(join(dir, "images", rel), bytes);
  return dir;
}
const read = (file: string) => readFileSync(file, "utf8");
const recorded = (root: string) => JSON.parse(read(join(root, ".content", "copied-images.json")));
const record = (root: string) => recorded(root).map((e: { path: string }) => e.path);
const image = (root: string, rel: string) => join(root, "public", "static", "images", rel);

describe("the blog's content step (ghostpen#135)", () => {
  it("builds .content/ from the named folder and copies and records its images", () => {
    const root = tempDir(), base = tempDir(), lines: string[] = [];
    const dir = folder(base, "notes", { "x/pic.png": "picture" });
    put(join(dir, "references.bib"), "@book{a}");
    const result = prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: dir }, log: (line) => lines.push(line) });
    expect(result).toEqual({ mode: "content", dir, images: ["x/pic.png"] });
    // A folder's site.json always has a home block, so the pages never show the legacy intro for it.
    expect(JSON.parse(read(join(root, ".content", "site.json")))).toEqual({ ...SITE, home: {} });
    expect(read(join(root, ".content", "blog", "nested", "post.mdx"))).toContain("title: 'P'");
    expect(existsSync(join(root, ".content", "authors", "default.mdx"))).toBe(true);
    expect(read(join(root, ".content", "references.bib"))).toBe("@book{a}");
    expect(read(join(root, ".content", "tag-data.json"))).toBe("{}\n");
    expect(read(image(root, "x/pic.png"))).toBe("picture");
    expect(record(root)).toEqual(["x/pic.png"]);
    expect(lines).toEqual([`ghostpen content: ${dir} (GHOSTPEN_CONTENT_DIR)`]);
  });

  it("removes the previous folder's images, and only those, when the folder changes", () => {
    const root = tempDir(), base = tempDir();
    put(image(root, "x/kept.png"), "tracked");
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "one", { "x/pic.png": "1", "deep/a/b.png": "2" }) }, log: () => {} });
    put(join(root, ".content", "blog", "stale.mdx"), "left from before");
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "two", { "y/other.png": "3" }) }, log: () => {} });
    expect(existsSync(image(root, "x/pic.png"))).toBe(false);
    expect(existsSync(image(root, "deep"))).toBe(false);
    expect(read(image(root, "x/kept.png"))).toBe("tracked");
    expect(read(image(root, "y/other.png"))).toBe("3");
    expect(record(root)).toEqual(["y/other.png"]);
    expect(existsSync(join(root, ".content", "blog", "stale.mdx"))).toBe(false);
  });

  it("keeps a copied image whose contents changed since, and records each copy's SHA-256", () => {
    const root = tempDir(), base = tempDir();
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "one", { "x/pic.png": "1", "x/b.png": "2" }) }, log: () => {} });
    expect(recorded(root).find((e: { path: string }) => e.path === "x/pic.png").sha256).toBe(createHash("sha256").update("1").digest("hex"));
    put(image(root, "x/pic.png"), "someone else's");
    const lines: string[] = [];
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "two") }, log: (line: string) => lines.push(line) });
    expect(read(image(root, "x/pic.png"))).toBe("someone else's");
    expect(existsSync(image(root, "x/b.png"))).toBe(false);
    expect(lines).toContain("ghostpen content: kept public/static/images/x/pic.png, changed since it was copied");
    expect(record(root)).toEqual([]);
  });

  it("never removes or copies through a symbolic link under public/static/images/", () => {
    const root = tempDir(), base = tempDir(), outside = tempDir();
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "one", { "x/pic.png": "1" }) }, log: () => {} });
    put(join(outside, "pic.png"), "1");
    rmSync(image(root, "x"), { recursive: true });
    symlinkSync(outside, image(root, "x"));
    const lines: string[] = [];
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "two") }, log: (line: string) => lines.push(line) });
    expect(read(join(outside, "pic.png"))).toBe("1");
    expect(lines).toContain("ghostpen content: kept public/static/images/x/pic.png, reached through a symbolic link");
    expect(() => prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "three", { "x/new.png": "n" }) }, log: () => {} }))
      .toThrow("GHOSTPEN_CONTENT_DIR: images/x/new.png would be copied through a symbolic link under public/static/images/");
    expect(existsSync(join(outside, "new.png"))).toBe(false);
  });

  it("refuses a record without a SHA-256 for each path, removing nothing", () => {
    const root = tempDir(), base = tempDir();
    put(image(root, "x/pic.png"), "1");
    put(join(root, ".content", "copied-images.json"), JSON.stringify(["x/pic.png"]));
    expect(() => prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "one") }, log: () => {} }))
      .toThrow(/copied-images.json must hold a list of \{ path, sha256 \}/);
    expect(read(image(root, "x/pic.png"))).toBe("1");
  });

  it("never overwrites an image it did not copy: an identical one is skipped, a different one refused", () => {
    const root = tempDir(), base = tempDir();
    put(image(root, "x/same.png"), "same");
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "one", { "x/same.png": "same" }) }, log: () => {} });
    expect(record(root)).toEqual([]);
    const other = folder(base, "two", { "x/same.png": "different", "a.png": "a" });
    expect(() => prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: other }, log: () => {} }))
      .toThrow("GHOSTPEN_CONTENT_DIR: images/x/same.png would replace public/static/images/x/same.png");
    expect(read(image(root, "x/same.png"))).toBe("same");
    // What it did copy before the refusal is recorded, so the next run removes it.
    expect(record(root)).toEqual(["a.png"]);
  });

  it("refuses a relative, missing or incomplete folder, naming GHOSTPEN_CONTENT_DIR and what is wrong", () => {
    const root = tempDir(), base = tempDir();
    const run = (dir: string) => () => prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: dir }, log: () => {} });
    expect(run("content-sample")).toThrow(/^GHOSTPEN_CONTENT_DIR \(content-sample\) must be an absolute path/);
    expect(run("")).toThrow(/^GHOSTPEN_CONTENT_DIR \(\) must be an absolute path/);
    expect(run(join(base, "nowhere"))).toThrow(/^GHOSTPEN_CONTENT_DIR .* is not an existing folder/);
    const noSite = folder(base, "no-site");
    rmSync(join(noSite, "site.json"));
    expect(run(noSite)).toThrow(/^GHOSTPEN_CONTENT_DIR .* has no site.json/);
    const badJson = folder(base, "bad-json");
    writeFileSync(join(badJson, "site.json"), "{ title");
    expect(run(badJson)).toThrow(/^GHOSTPEN_CONTENT_DIR .*: site.json is not valid JSON/);
    expect(run(folder(base, "list", {}, [SITE]))).toThrow(/^GHOSTPEN_CONTENT_DIR .*: site.json must hold a JSON object/);
    expect(run(folder(base, "no-url", {}, { title: "T", author: "A" }))).toThrow(/^GHOSTPEN_CONTENT_DIR .*: site.json has no siteUrl/);
    expect(run(folder(base, "bad-home", {}, { ...SITE, home: "x" }))).toThrow(/^GHOSTPEN_CONTENT_DIR .*: site.json's home must be an object/);
    const noAuthor = folder(base, "no-author");
    rmSync(join(noAuthor, "authors", "default.mdx"));
    expect(run(noAuthor)).toThrow(/^GHOSTPEN_CONTENT_DIR .* has no authors\/default.mdx/);
    const noBlog = folder(base, "no-blog");
    rmSync(join(noBlog, "blog"), { recursive: true });
    expect(run(noBlog)).toThrow(/^GHOSTPEN_CONTENT_DIR .* has no blog\/ folder/);
    expect(existsSync(join(root, ".content"))).toBe(false);
  });

  it("refuses the repository's own content when GHOSTPEN_REQUIRE_CONTENT=1 and the variable is unset", () => {
    const root = tempDir();
    folder(root, "data");
    expect(() => prepareContent({ root, env: { GHOSTPEN_REQUIRE_CONTENT: "1" }, log: () => {} }))
      .toThrow(/^GHOSTPEN_CONTENT_DIR is not set/);
  });

  it("in legacy mode builds .content/ from data/ and data/site.legacy.js, copies no image and removes a content folder's", () => {
    const root = tempDir(), base = tempDir(), lines: string[] = [];
    const data = folder(root, "data", {}, { title: "Not this one" });
    put(join(data, "site.legacy.js"), `module.exports = ${JSON.stringify({ ...SITE, home: { name: "dropped" } })}`);
    put(join(data, "references-data.bib"), "@book{b}");
    put(join(data, "siteMetadata.js"), "module.exports = {}");
    prepareContent({ root, env: { GHOSTPEN_CONTENT_DIR: folder(base, "notes", { "n/pic.png": "n" }) }, log: () => {} });
    expect(existsSync(image(root, "n/pic.png"))).toBe(true);
    const result = prepareContent({ root, env: {}, log: (line) => lines.push(line) });
    expect(result).toEqual({ mode: "legacy", dir: data, images: [] });
    expect(JSON.parse(read(join(root, ".content", "site.json")))).toEqual(SITE);
    expect(existsSync(join(root, ".content", "blog", "nested", "post.mdx"))).toBe(true);
    expect(existsSync(join(root, ".content", "authors", "default.mdx"))).toBe(true);
    expect(read(join(root, ".content", "references-data.bib"))).toBe("@book{b}");
    expect(existsSync(join(root, ".content", "siteMetadata.js"))).toBe(false);
    expect(existsSync(image(root, "n/pic.png"))).toBe(false);
    expect(record(root)).toEqual([]);
    expect(lines).toEqual(["ghostpen content: the repository's own (legacy)"]);
    put(join(data, "site.legacy.js"), `module.exports = { title: "T" }`);
    expect(() => prepareContent({ root, env: {}, log: () => {} })).toThrow(/^data\/site.legacy.js has no author, siteUrl/);
    rmSync(join(data, "site.legacy.js"));
    expect(() => prepareContent({ root, env: {}, log: () => {} })).toThrow(/^data\/ has no site.legacy.js/);
  });
});
