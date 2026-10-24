/**
 * The `sources` block of ghostpen's settings (ADR 0101, brief D8): which folders and repositories ghostpen reads. Nothing
 * here assumes Obsidian; Tim's layout is one such block in his settings (adapter/docs/sources.md). Every error names the
 * field, never its value.
 */
import { isAbsolute } from "node:path";

export interface MarkdownSource { name: string; kind: "markdown"; root: string; include: string[]; as: "decision" | "experiment" }
export interface GithubSource {
  name: string; kind: "github"; repos: string[];
  /** Issues with this label are incidents worth a post. */
  incidentLabel: string;
  /** A merged PR whose body matches this (a regular expression, case-insensitive) reports measured results. */
  measuredPattern: string;
  /** How many days back to read (default 60). */
  days: number;
  /** A file holding a GitHub token that can read these repos (absolute); unset reads without one (public repos only). */
  tokenFile?: string;
}
export type TopicSource = MarkdownSource | GithubSource;
export interface GlossarySource { name: string; kind: "glossary"; root: string; include: string[] }
export interface PublishedSource { blogDir: string; baseUrl: string }
export interface SourcesSettings { topics: TopicSource[]; references: GlossarySource[]; published?: PublishedSource }

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v !== "")) {
    throw new Error(`settings: ${field} must be a non-empty list of strings`);
  }
  return value as string[];
}

function folder(raw: Rec, field: string): { root: string; include: string[] } {
  if (typeof raw.root !== "string" || !isAbsolute(raw.root)) throw new Error(`settings: ${field}.root must be an absolute path`);
  const include = strings(raw.include, `${field}.include`);
  if (include.some((pattern) => isAbsolute(pattern) || pattern.split("/").includes(".."))) {
    throw new Error(`settings: ${field}.include patterns must stay inside root`);
  }
  return { root: raw.root, include };
}

function topic(raw: unknown, field: string): TopicSource {
  if (!isRec(raw) || typeof raw.name !== "string" || !NAME.test(raw.name)) throw new Error(`settings: ${field}.name must be a name`);
  if (raw.kind === "markdown") {
    const as = raw.as ?? "decision";
    if (as !== "decision" && as !== "experiment") throw new Error(`settings: ${field}.as must be decision or experiment`);
    return { name: raw.name, kind: "markdown", ...folder(raw, field), as };
  }
  if (raw.kind === "github") {
    const repos = strings(raw.repos, `${field}.repos`);
    if (!repos.every((repo) => REPO.test(repo))) throw new Error(`settings: ${field}.repos must be owner/repo names`);
    if (typeof raw.incidentLabel !== "string" || raw.incidentLabel === "") throw new Error(`settings: ${field}.incidentLabel must be a label`);
    if (typeof raw.measuredPattern !== "string") throw new Error(`settings: ${field}.measuredPattern must be a regular expression`);
    try { new RegExp(raw.measuredPattern, "iu"); } catch { throw new Error(`settings: ${field}.measuredPattern must be a regular expression`); }
    const days = raw.days ?? 60;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650) throw new Error(`settings: ${field}.days must be 1 to 3650`);
    if (raw.tokenFile !== undefined && (typeof raw.tokenFile !== "string" || !isAbsolute(raw.tokenFile))) {
      throw new Error(`settings: ${field}.tokenFile must be an absolute path`);
    }
    return { name: raw.name, kind: "github", repos, incidentLabel: raw.incidentLabel, measuredPattern: raw.measuredPattern, days,
      ...(raw.tokenFile ? { tokenFile: raw.tokenFile as string } : {}) };
  }
  throw new Error(`settings: ${field}.kind must be markdown or github`);
}

/** The `sources` block; absent means nothing is read yet (ghostpen has nothing to rank). */
export function parseSources(raw: unknown): SourcesSettings {
  if (raw === undefined) return { topics: [], references: [] };
  if (!isRec(raw)) throw new Error("settings: sources must be an object");
  const topics = raw.topics === undefined ? [] : Array.isArray(raw.topics) ? raw.topics.map((t, i) => topic(t, `sources.topics[${i}]`))
    : (() => { throw new Error("settings: sources.topics must be a list"); })();
  const references = raw.references === undefined ? [] : Array.isArray(raw.references) ? raw.references.map((r, i) => {
    const field = `sources.references[${i}]`;
    if (!isRec(r) || typeof r.name !== "string" || !NAME.test(r.name)) throw new Error(`settings: ${field}.name must be a name`);
    if (r.kind !== "glossary") throw new Error(`settings: ${field}.kind must be glossary`);
    return { name: r.name, kind: "glossary" as const, ...folder(r, field) };
  }) : (() => { throw new Error("settings: sources.references must be a list"); })();
  const names = [...topics, ...references].map((s) => s.name);
  if (new Set(names).size !== names.length) throw new Error("settings: sources names must be unique");
  let published: PublishedSource | undefined;
  if (raw.published !== undefined) {
    const p = raw.published;
    if (!isRec(p) || typeof p.blogDir !== "string" || !isAbsolute(p.blogDir)) throw new Error("settings: sources.published.blogDir must be an absolute path");
    if (typeof p.baseUrl !== "string" || !/^https?:\/\/\S+$/u.test(p.baseUrl)) throw new Error("settings: sources.published.baseUrl must be a web address");
    published = { blogDir: p.blogDir, baseUrl: p.baseUrl.replace(/\/+$/u, "") };
  }
  return { topics, references, ...(published ? { published } : {}) };
}
