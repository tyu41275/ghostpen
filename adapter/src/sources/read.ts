/**
 * Every configured source read once (ADR 0101, brief D8): the topic documents, the stack parts' definitions, and the
 * published-post index built from them. The ranking and the draft writer read the same way; every problem is returned.
 */
import type { GhostpenSettings } from "../settings.js";
import { liveGithubGet, readGithubTopics } from "./github.js";
import { readGlossaries, readMarkdownTopics } from "./markdown.js";
import { buildPublishedIndex, type PublishedIndex } from "./published.js";
import type { Definition, SourceProblem, TopicDocument } from "./types.js";

export interface SourcesRead { documents: TopicDocument[]; definitions: Definition[]; terms: string[]; index: PublishedIndex; problems: SourceProblem[] }

export async function readSources(settings: GhostpenSettings, now?: Date): Promise<SourcesRead> {
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
  if (settings.sources.published) {
    const built = buildPublishedIndex(settings.sources.published, terms, settings.dataDir);
    index = built.index;
    problems.push(...built.problems);
  }
  return { documents, definitions, terms, index, problems };
}
