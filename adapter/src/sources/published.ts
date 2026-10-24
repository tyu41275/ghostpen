/**
 * The published-post index (ADR 0101, brief D1 and D8): for each post in the blog folder, what it is **about** (a stack
 * part named in its title, tags or summary) and what it only **mentions** (named in its body). Kept in ghostpen's data
 * folder by each post's content hash: every build reads and hashes each post, and parses again only the changed ones. It answers "is
 * there a post about X?" with the post's address, which a draft must link instead of explaining X again.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublishedSource } from "./config.js";
import type { SourceProblem } from "./types.js";

export interface PublishedPost {
  file: string; hash: string; url: string; title: string; date: string; tags: string[]; draft: boolean;
  /** Stack parts (from the terms given) the post is about: in its title, tags or summary. Lower case. */
  about: string[];
  /** Stack parts named only in its body. Lower case. */
  mentions: string[];
}
export interface PublishedIndex { version: 1; terms: string; posts: PublishedPost[] }
export const INDEX_FILE = "published-index.json";

/** The frontmatter fields the index uses, from a post's `---` block (single- or double-quoted strings and `[...]` lists). */
export function frontmatter(text: string): { fields: Record<string, string | string[]>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string | string[]> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/u.exec(line);
    if (!kv) continue;
    const value = kv[2]!.trim();
    const unquote = (v: string) => v.replace(/^(['"])(.*)\1$/u, "$2");
    fields[kv[1]!] = value.startsWith("[") ? value.replace(/^\[|\]$/gu, "").split(",").map((v) => unquote(v.trim())).filter(Boolean)
      : unquote(value);
  }
  return { fields, body: text.slice(match[0].length) };
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const named = (text: string, term: string) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term)}($|[^A-Za-z0-9])`, "iu").test(text);

function indexPost(file: string, text: string, hash: string, source: PublishedSource, terms: string[]): PublishedPost {
  const { fields, body } = frontmatter(text);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const tags = Array.isArray(fields.tags) ? fields.tags : [];
  const head = [str(fields.title), str(fields.summary), ...tags].join("\n");
  const about = terms.filter((term) => named(head, term));
  const mentions = terms.filter((term) => !about.includes(term) && named(body, term));
  return { file, hash, url: `${source.baseUrl}/blog/${file.replace(/\.mdx?$/u, "")}`, title: str(fields.title), date: str(fields.date),
    tags, draft: fields.draft === "true", about, mentions };
}

/**
 * The index for the blog folder now, against `terms` (the stack parts' names, e.g. glossary terms). A post whose hash and
 * the term list are unchanged keeps its stored entry; the rest are read again. Writes the index to `dataDir`.
 */
export function buildPublishedIndex(source: PublishedSource, terms: string[], dataDir: string):
  { index: PublishedIndex; problems: SourceProblem[] } {
  const wanted = [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))].sort();
  // The key covers what an entry is built from besides the post: the terms and the blog's address (its URLs).
  const termsKey = createHash("sha256").update(`${source.baseUrl}\n${wanted.join("\n")}`).digest("hex").slice(0, 16);
  const path = join(dataDir, INDEX_FILE);
  let kept = new Map<string, PublishedPost>();
  try {
    const stored = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as PublishedIndex : undefined;
    if (stored?.version === 1 && stored.terms === termsKey) kept = new Map(stored.posts.map((post) => [post.file, post]));
  } catch { /* an unreadable index is rebuilt */ }
  let names: string[];
  try {
    names = readdirSync(source.blogDir).filter((name) => /\.mdx?$/u.test(name)).sort();
  } catch {
    return { index: { version: 1, terms: termsKey, posts: [] }, problems: [{ source: "published", problem: `the blog folder ${source.blogDir} cannot be read` }] };
  }
  const problems: SourceProblem[] = [];
  const posts: PublishedPost[] = [];
  for (const name of names) {
    let text: string;
    try { text = readFileSync(join(source.blogDir, name), "utf8"); } catch {
      problems.push({ source: "published", problem: `the post ${name} cannot be read` }); // one bad file never stops the rest
      continue;
    }
    const hash = createHash("sha256").update(text).digest("hex");
    const old = kept.get(name);
    posts.push(old && old.hash === hash ? old : indexPost(name, text, hash, source, wanted));
  }
  const index: PublishedIndex = { version: 1, terms: termsKey, posts };
  writeFileSync(`${path}.tmp`, JSON.stringify(index, null, 2));
  renameSync(`${path}.tmp`, path);
  return { index, problems };
}

/** The published (not draft) posts about `term`, newest first: what a draft links instead of explaining it again. */
export function postsAbout(index: PublishedIndex, term: string): PublishedPost[] {
  const key = term.trim().toLowerCase();
  return index.posts.filter((post) => !post.draft && post.about.includes(key)).sort((a, b) => b.date.localeCompare(a.date));
}
