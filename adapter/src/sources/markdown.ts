/**
 * Readers for folders of markdown (ADR 0101, brief D8): decision documents and experiment records as topic documents,
 * and glossaries (`## Term` sections) as definitions. Plain files only: nothing here knows Obsidian. A folder that is
 * missing, or a pattern that matches nothing, is a problem named with its source, never an empty result.
 */
import { globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { GlossarySource, MarkdownSource } from "./config.js";
import type { Definition, Read, TopicDocument } from "./types.js";

const MAX_BYTES = 1024 * 1024; // a document larger than this is skipped and reported, never half read

/** The files `include` matches under `root`, sorted, each still inside root (a symlink out of it is refused). */
function files(source: { name: string; root: string; include: string[] }): { paths: string[]; problems: string[] } {
  let root: string;
  try {
    root = realpathSync(source.root);
    if (!statSync(root).isDirectory()) throw new Error("not a folder");
  } catch {
    return { paths: [], problems: [`its folder ${source.root} cannot be read`] };
  }
  const found = new Set<string>();
  const problems: string[] = [];
  for (const pattern of source.include) {
    const matched = globSync(pattern, { cwd: root }).map((path) => join(root, path));
    if (matched.length === 0) problems.push(`its pattern ${pattern} matches no file`);
    for (const path of matched) {
      let real: string;
      try { real = realpathSync(path); } catch { continue; }
      if (relative(root, real).startsWith("..")) { problems.push(`${relative(root, path)} leads outside its folder`); continue; }
      if (statSync(real).isFile()) found.add(path);
    }
  }
  return { paths: [...found].sort(), problems };
}

function text(path: string): string | Error {
  try {
    if (statSync(path).size > MAX_BYTES) return new Error("is larger than 1 MiB");
    return readFileSync(path, "utf8");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** A document's title: its first `# ` heading, else its file name. */
const titleOf = (lines: string[], path: string): string =>
  lines.find((line) => line.startsWith("# "))?.slice(2).trim() || path.split("/").pop()!.replace(/\.md$/u, "");

export function readMarkdownTopics(source: MarkdownSource): Read<TopicDocument> {
  const { paths, problems } = files(source);
  const items: TopicDocument[] = [];
  for (const path of paths) {
    const content = text(path);
    if (content instanceof Error) { problems.push(`${relative(source.root, path)} ${content.message}`); continue; }
    const lines = content.split("\n");
    items.push({ id: `${source.name}:${relative(source.root, path)}`, kind: source.as, source: source.name, title: titleOf(lines, path),
      lines, location: { path, line: 1 }, updated: statSync(path).mtime.toISOString() });
  }
  return { items, problems: problems.map((problem) => ({ source: source.name, problem })) };
}

/**
 * Each `## Term` section of each glossary file: the term, and its text up to the next heading. A term defined twice
 * keeps both, each with its own location: the caller sees the clash.
 */
export function readGlossaries(source: GlossarySource): Read<Definition> {
  const { paths, problems } = files(source);
  const items: Definition[] = [];
  for (const path of paths) {
    const content = text(path);
    if (content instanceof Error) { problems.push(`${relative(source.root, path)} ${content.message}`); continue; }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const heading = /^## (.+)$/u.exec(lines[i]!);
      if (!heading) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && !/^#{1,2} /u.test(lines[j]!); j += 1) body.push(lines[j]!);
      const definition = body.join("\n").trim();
      if (definition) items.push({ term: heading[1]!.trim(), text: definition, location: { path, line: i + 1 }, source: source.name });
    }
  }
  return { items, problems: problems.map((problem) => ({ source: source.name, problem })) };
}
