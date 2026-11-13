/**
 * The needs that are what ghostpen reads (`readiness.ts`, adapter/docs/sources.md). Each asks only whether a folder or a
 * file can be read, with one call that does not block: it never lists, globs or reads a source, and never asks GitHub.
 * What a ranking found wrong while reading is counted from the last ranking.json, never quoted: a problem there holds paths.
 */
import { constants } from "node:fs";
import { failing, type Facts, fileProblem, folderProblem, more, type Need, notSetUp, type Reading, timeOf, working } from "./readiness-reading.js";
import { RANK } from "./readiness-settings.js";

const source = { kind: "source", required: false, spends: "none" } as const;
const READS = constants.R_OK | constants.X_OK;
const add = (block: string) => `Add ${block} to ghostpen's kept settings (adapter/docs/sources.md), then restart ghostpen's service.`;
const CORRECT = "Correct the setting named here in ghostpen's kept settings (adapter/docs/sources.md), then restart ghostpen's service.";

/** The first of `problems` and how many more, or working. */
function problemsReading(f: Facts, problems: Array<string | undefined>, good: string): Reading {
  const found = problems.filter((p): p is string => p !== undefined);
  return found[0] === undefined ? working(good, f.started.getTime()) : failing(`${found[0]}${more(found.length - 1)}`, f.now.getTime(), CORRECT);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const SOURCE_NEEDS: Need[] = [
  { ...source, id: "topic-sources", label: "Topic sources", fix: add("sources.topics"),
    check: async (f) => {
      const topics = f.settings.sources.topics;
      if (topics.length === 0) return notSetUp("sources.topics is empty, so there is nothing to rank", f);
      const problems = await Promise.all(topics.map(async (topic, i) => {
        const field = `sources.topics[${i}]`;
        if (topic.kind === "markdown") { const p = await folderProblem(topic.root, READS); return p && `${field}.root: ${p}`; }
        if (topic.tokenFile !== undefined) { const p = await fileProblem(topic.tokenFile, constants.R_OK); return p && `${field}.tokenFile: ${p}`; }
        return undefined;
      }));
      const asked = problemsReading(f, problems, `${plural(topics.length, "topic source", "topic sources")} can be read`);
      if (asked.state !== "working") return asked;
      // A source's problem in the ranking starts with its name (src/ranking/run.ts); the ranking need answers for a file that does not read.
      const kept = await f.ranking();
      if (kept.state !== "ok") return asked;
      const names = topics.map((topic) => `${topic.name}: `);
      const count = kept.value.problems.filter((p) => names.some((name) => p.startsWith(name))).length;
      if (count === 0) return asked;
      const at = timeOf(kept.value.ranAt);
      return failing(`the last ranking, at ${at === undefined ? "an unknown time" : new Date(at).toISOString()}, has ${plural(count, "problem", "problems")} reading the topic sources`,
        at ?? f.now.getTime(), `Read them on ghostpen's app page, correct the sources (adapter/docs/sources.md), then rank again: ${RANK}.`);
    } },
  { ...source, id: "glossaries", label: "Glossaries", fix: add("sources.references"),
    check: async (f) => {
      const references = f.settings.sources.references;
      if (references.length === 0) return notSetUp("sources.references is empty, so no stack part's definition is read", f);
      const problems = await Promise.all(references.map(async (reference, i) => {
        const p = await folderProblem(reference.root, READS);
        return p && `sources.references[${i}].root: ${p}`;
      }));
      return problemsReading(f, problems, `${plural(references.length, "glossary", "glossaries")} can be read`);
    } },
  { ...source, id: "published-posts", label: "Published posts", fix: add("sources.published"),
    check: async (f) => {
      const published = f.settings.sources.published;
      if (published === undefined) return notSetUp("sources.published is not set, so ghostpen cannot tell what is published already", f);
      const p = await folderProblem(published.blogDir, READS);
      return problemsReading(f, [p && `sources.published.blogDir: ${p}`], "the blog's posts folder can be read");
    } },
];
