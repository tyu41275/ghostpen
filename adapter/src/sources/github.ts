/**
 * GitHub as a topic source (ADR 0101, brief D8, Q9): issues carrying the configured incident label, and merged pull
 * requests whose body matches the configured "measured results" pattern, from the last `days` days. Each becomes a
 * topic document whose lines are its body, located by its web address. A repository that cannot be read is a problem
 * named with its source, never an empty result.
 */
import { readFileSync } from "node:fs";
import type { GithubSource } from "./config.js";
import type { Read, TopicDocument } from "./types.js";

/** One GitHub REST GET (`/repos/...`), answering the parsed JSON; tests pass recorded answers. */
export type GithubGet = (path: string) => Promise<unknown>;

const PAGES = 10; // 1,000 newest per list; more in the window is reported, never silently dropped
type Rec = Record<string, unknown>;

/** The live reader: api.github.com, with the source's token when it names one. */
export function liveGithubGet(source: GithubSource): GithubGet {
  const token = source.tokenFile ? readFileSync(source.tokenFile, "utf8").trim() : undefined;
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, { signal: AbortSignal.timeout(30_000), headers: {
      accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return response.json();
  };
}

function document(source: GithubSource, repo: string, item: Rec, kind: "issue" | "pull"): TopicDocument {
  const body = typeof item.body === "string" ? item.body : "";
  return { id: `${source.name}:${repo}#${String(item.number)}`, kind, source: source.name, title: String(item.title ?? ""),
    lines: [`# ${String(item.title ?? "")}`, "", ...body.replace(/\r\n/gu, "\n").split("\n")],
    location: { url: String(item.html_url ?? `https://github.com/${repo}/${kind === "pull" ? "pull" : "issues"}/${String(item.number)}`) },
    ...(typeof item.updated_at === "string" ? { updated: item.updated_at } : {}) };
}

/**
 * Pages of a list, newest first, until one is short or older than `cutoff` (by `field`). `truncated` says the last page
 * read was still full and inside the window: more results exist than were read, which the caller reports.
 */
async function pages(get: GithubGet, path: string, field: string, cutoff: number): Promise<{ items: Rec[]; truncated: boolean }> {
  const items: Rec[] = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const batch = await get(`${path}&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("GitHub answered something other than a list");
    items.push(...batch as Rec[]);
    const last = batch[batch.length - 1] as Rec | undefined;
    if (batch.length < 100 || !last || Date.parse(String(last[field])) < cutoff) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export async function readGithubTopics(source: GithubSource, get: GithubGet, now: Date = new Date()): Promise<Read<TopicDocument>> {
  const cutoff = now.getTime() - source.days * 86_400_000;
  const since = new Date(cutoff).toISOString();
  const measured = new RegExp(source.measuredPattern, "iu");
  const items: TopicDocument[] = [];
  const problems: Read<TopicDocument>["problems"] = [];
  for (const repo of source.repos) {
    try {
      const issues = await pages(get, `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(source.incidentLabel)}&since=${since}&sort=updated&direction=desc`,
        "updated_at", cutoff);
      for (const issue of issues.items) if (!issue.pull_request) items.push(document(source, repo, issue, "issue"));
      const pulls = await pages(get, `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc`, "updated_at", cutoff);
      for (const [list, read] of [["issues", issues], ["pull requests", pulls]] as const) {
        if (read.truncated) problems.push({ source: source.name, problem: `${repo} has more ${list} in the last ${source.days} days than the ${PAGES * 100} newest read` });
      }
      for (const pull of pulls.items) {
        const merged = typeof pull.merged_at === "string" ? Date.parse(pull.merged_at) : NaN;
        if (Number.isFinite(merged) && merged >= cutoff && measured.test(typeof pull.body === "string" ? pull.body : "")) {
          items.push(document(source, repo, pull, "pull"));
        }
      }
    } catch (error) {
      problems.push({ source: source.name, problem: `${repo} cannot be read (${error instanceof Error ? error.message : String(error)})` });
    }
  }
  return { items, problems };
}
