/**
 * ghostpen#86's done-when, as a gate: no code or default in the repository names one machine's folders (a Windows drive
 * path, a person's home or Mac user folder), and nothing installs a Claude hook (the post-ship hook ADR 0101 retired).
 * Settings name every machine-specific value (docs/sources.md, docs/install.md).
 * It walks the files on disk rather than asking git, so it runs on a copy with no `.git`. Markdown, the blog's posts and
 * images, dependencies and the build's output are out of scope: they describe or are not ours. The blog's own code and
 * defaults in `data/` and `public/` (site metadata, the CMS config) are in it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** This file spells out every pattern it looks for. */
const SELF = "adapter/test/repo-portable.test.ts";

/** Folders skipped by name wherever they are: version control, dependencies and build output. */
const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".contentlayer", "dist", ".yarn"]);
/** Content folders, skipped by their path from the repository root: the posts and their images. */
const SKIP_PATHS = new Set(["data/blog", "public/static"]);
const CODE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh", ".json", ".yml", ".yaml", ".toml"]);
/** Test fixtures stand for "a path on some machine" with these names; the privacy checks must see them redacted. */
const FIXTURE_USERS = new Set(["someone"]);

/** A path, not the path part of a web address: no word character, dot or dash right before it (`example.test/Users/…`); a drive letter not after a slash either (`example.test/C:/…`). */
const LEAD = String.raw`(?<![\w.-])`;
const MACHINE = [
  { what: "a Windows drive path", re: new RegExp(String.raw`(?<![\w./\\-])[A-Za-z]:[\\/]+(?:Repos|Users|Projects|src|code)\b`, "gu") },
  { what: "a Mac user folder", re: new RegExp(String.raw`${LEAD}/Users/[A-Za-z][\w.-]*/`, "gu") },
  { what: "a home folder", re: new RegExp(String.raw`${LEAD}/home/([a-z_][\w-]*)/`, "gu"), user: 1 },
] as const;
const HOOK = [
  { what: "a Claude settings file", re: /\.claude[\\/]+settings(?:\.local)?\.json/gu },
  { what: "a Claude hook event", re: /\b(?:PostToolUse|PreToolUse|SessionStart|UserPromptSubmit)\b/gu },
] as const;

/** Every code file under `root`, as a path relative to it with `/` separators. */
export function codeFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name), from = relative(root, path).split(sep).join("/");
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) || SKIP_PATHS.has(from) ? [] : codeFiles(root, path);
    return entry.isFile() && CODE.has(extname(entry.name)) && entry.name !== "package-lock.json" && entry.name !== "yarn.lock"
      ? [from] : [];
  });
}

/** Each machine-specific path or Claude hook in `text`, as `file:line: what (match)`. */
export function findings(file: string, text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, index) => {
    for (const rule of [...MACHINE, ...HOOK]) {
      for (const match of line.matchAll(rule.re)) {
        if ("user" in rule && FIXTURE_USERS.has(match[rule.user]!)) continue;
        found.push(`${file}:${index + 1}: ${rule.what} (${match[0]})`);
      }
    }
  });
  return found;
}

describe("the repository is portable and installs no Claude hook (ghostpen#86)", () => {
  it("finds each kind of machine path and hook, and passes a fixture's /home/someone", () => {
    expect(findings("x.py", 'default=os.environ.get("ECOORCHESTRA_DIR", "C:/Repos/EcoOrchestra")\nok = "/home/someone/x"')).toEqual([
      "x.py:1: a Windows drive path (C:/Repos)"]);
    expect(findings("a.sh", 'cd /home/alex/repos && open /Users/alex/Desktop/\njq .hooks ~/.claude/settings.json # PostToolUse')).toEqual([
      "a.sh:1: a Mac user folder (/Users/alex/)", "a.sh:1: a home folder (/home/alex/)",
      "a.sh:2: a Claude settings file (.claude/settings.json)", "a.sh:2: a Claude hook event (PostToolUse)"]);
    expect(findings("b.ts", 'const url = "https://example.com/home/page"; const p = join(homedir(), "x");')).toEqual([]);
    // The path part of a web address is not a machine's folder.
    expect(findings("c.ts", 'fetch("https://example.test/Users/alex/profile"); open("http://h.example/home/alex/x/")')).toEqual([]);
    expect(findings("d.ts", 'fetch("https://example.test/C:/Repos/docs"); const p = "D:\\\\Projects\\\\x";')).toEqual(["d.ts:1: a Windows drive path (D:\\\\Projects)"]);
  });

  it("holds no machine-specific path or Claude hook in any code file", () => {
    const files = codeFiles(REPO_ROOT).filter((file) => file !== SELF);
    // The walk reached both the blog and the adapter: a wrong root would pass on nothing.
    expect(files).toEqual(expect.arrayContaining(["contentlayer.config.ts", "adapter/src/settings.ts", "adapter/scripts/install-host.sh", "scripts/rss.mjs",
      "data/siteMetadata.js", "data/projectsData.ts", "public/admin/config.yml"]));
    expect(files.flatMap((file) => findings(file, readFileSync(join(REPO_ROOT, file), "utf8")))).toEqual([]);
  });
});
