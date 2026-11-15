/**
 * Every configured source read once (ADR 0101, brief D8): the topic documents, the stack parts' definitions, and the
 * published-post index built from them, with which of its posts the blog serves (its sitemap). The ranking and the
 * draft writer read the same way; every problem is returned.
 */
import type { GhostpenSettings } from "../settings.js";
import { liveGithubGet, readGithubTopics } from "./github.js";
import { readGlossaries, readMarkdownTopics } from "./markdown.js";
import { buildPublishedIndex, type PublishedIndex } from "./published.js";
import { readServed, withServed, type Served, type SitemapGet } from "./served.js";
import type { Definition, SourceProblem, TopicDocument } from "./types.js";

export interface SourcesRead {
  documents: TopicDocument[]; definitions: Definition[]; terms: string[]; index: PublishedIndex; problems: SourceProblem[];
  /** The blog's sitemap read, when `sources.published` is set. */
  served?: Served;
}

/** `get`: the sitemap reader (tests pass recorded answers); the live one by default. */
export async function readSources(settings: GhostpenSettings, now?: Date, get?: SitemapGet): Promise<SourcesRead> {
  const problems: SourceProblem[] = [];
  const documents: TopicDocument[] = [];
  for (const source of settings.sources.topics) {
    const read = source.kind === "markdown" ? readMarkdownTopics(source) : await readGithubTopics(source, liveGithubGet(source), now);
    documents.push(...read.items);
    problems.push(...read.problems);
  }
  const definitions: Definition[] = [];
  for (const source of settings.sources.references) {
    const read = readGlossaries(source);
    definitions.push(...read.items);
    problems.push(...read.problems);
  }
  const terms = definitions.map((d) => d.term);
  let index: PublishedIndex = { version: 1, terms: "", posts: [] };
  let served: Served | undefined;
  if (settings.sources.published) {
    const built = buildPublishedIndex(settings.sources.published, terms, settings.dataDir);
    problems.push(...built.problems);
    served = await readServed(settings.sources.published, get);
    index = withServed(built.index, served);
    if ("problem" in served) problems.push({ source: "published", problem: served.problem });
    const dropped = index.posts.filter((post) => !post.draft && post.served === false).map((post) => post.file);
    if (dropped.length) {
      const list = `${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? `, and ${dropped.length - 10} more` : ""}`;
      const what = dropped.length === 1 ? ["1 post is", "it"] : [`${dropped.length} posts are`, "them"];
      problems.push({ source: "published", problem: `${what[0]} in the blog folder but the site does not serve ${what[1]}: ${list}` });
    }
  }
  return { documents, definitions, terms, index, problems, ...(served ? { served } : {}) };
}
