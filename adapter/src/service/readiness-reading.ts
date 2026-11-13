/**
 * The shapes of a readiness need (`readiness.ts`) and the few ways one reads. The route asks for no key and chatter posts
 * what it says, so a reason is fixed words, the names of settings, counts and times: never a path, an address, a token or
 * an error's own text. `line` takes out any path or address that slipped in all the same. Missing is never working.
 */
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { isRankingView, RANKING_FILE, type RankingView } from "../ranking/run.js";
import type { GhostpenSettings } from "../settings.js";

export type NeedState = "working" | "short_of_data" | "waiting_for_operator" | "not_set_up" | "failing" | "chosen_off";
/** `fix`, when this reading has a better one than its need's. */
export interface Reading { state: NeedState; why: string; since: string; expected_by?: string; fix?: string }
/** A file the list reads once: not there yet, there but not usable, or read. */
export type Kept<T> = { state: "none" } | { state: "bad" } | { state: "ok"; value: T };
/**
 * What a need is checked against. `settings` and the keys are what the service started on, the ones every request uses:
 * it takes up a changed file only on a restart. `ranking` reads its file once per list, without blocking.
 */
export interface Facts {
  settings: GhostpenSettings; settingsFile: string | undefined; appKey: Buffer | undefined; adapterKey: Buffer | undefined;
  now: Date; started: Date; ranking: () => Promise<Kept<RankingView>>;
}
export interface Need {
  id: string; label: string; kind: "setting" | "source" | "job"; required: boolean; spends: "usage" | "behaviour" | "none"; fix: string;
  check: (facts: Facts) => Reading | Promise<Reading>;
}

const iso = (ms: number) => new Date(ms).toISOString();
/** One line of chatter's wire format, at most 300 characters and never empty, with no path or address in it. */
export function line(text: string): string {
  const words = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, "[address]").replace(/(['"`])(?:\/|\[path\]).*\1(?=[\s,;:)]|$)/gu, "$1[path]$1")
    .replace(/(?<![\w.:/-])\/[^\s'"`,;:)]+/gu, "[path]").replace(/(?:\[path\])+/gu, "[path]")
    .replace(/[\s\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, 300).trim();
  return words === "" ? "no reason was given" : words;
}

export const working = (why: string, at: number): Reading => ({ state: "working", why, since: iso(at) });
export const failing = (why: string, at: number, fix?: string): Reading => ({ state: "failing", why, since: iso(at), ...(fix === undefined ? {} : { fix }) });
export const chosenOff = (why: string, facts: Facts): Reading => ({ state: "chosen_off", why, since: facts.started.toISOString() });
export const notSetUp = (why: string, facts: Facts): Reading => ({ state: "not_set_up", why, since: facts.started.toISOString() });
/** A time a file holds, as milliseconds; undefined when it is no time. A reason shows it only re-written, never as the file said it. */
export const timeOf = (text: unknown): number | undefined => {
  const at = typeof text === "string" ? Date.parse(text) : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
};
/** ` (and N more)` after the first of several. */
export const more = (extra: number) => (extra > 0 ? ` (and ${extra} more)` : "");

const code = (error: unknown) => String((error as NodeJS.ErrnoException).code ?? "an unknown error");

/** Why `dir` is not a folder usable as `mode` asks, undefined when it is. One call that does not block; the `/.` makes a file refuse. */
export async function folderProblem(dir: string, mode: number): Promise<string | undefined> {
  try {
    await access(`${dir}/.`, mode);
    return undefined;
  } catch (error) {
    const why = code(error);
    return why === "ENOENT" ? "the folder is missing" : why === "ENOTDIR" ? "it is not a folder" : `it cannot be used (${why})`;
  }
}

/** Why `file` is not a plain file usable as `mode` asks, undefined when it is. A pipe is refused unread: reading one blocks. */
export async function fileProblem(file: string, mode: number): Promise<string | undefined> {
  try {
    if (!(await stat(file)).isFile()) return "it is not a file";
    await access(file, mode);
    return undefined;
  } catch (error) {
    const why = code(error);
    return why === "ENOENT" || why === "ENOTDIR" ? "the file is missing" : `it cannot be used (${why})`;
  }
}

/** Why `program` (a command's first word) cannot be run, undefined when it can: a path is asked as it is, a bare name on PATH. */
export async function programProblem(program: string, path = process.env.PATH ?? ""): Promise<string | undefined> {
  const runnable = async (file: string) => (await fileProblem(file, constants.X_OK)) === undefined;
  if (program.includes("/")) {
    const problem = await fileProblem(program, constants.X_OK);
    return problem === undefined ? undefined : problem === "it cannot be used (EACCES)" ? "it cannot be run" : problem;
  }
  for (const dir of path.split(delimiter).filter(Boolean)) if (await runnable(join(dir, program))) return undefined;
  return "it is not found on PATH";
}

/** A JSON file in the data folder, read once: none, unusable, or what `parse` made of it. */
async function keptFile<T>(dataDir: string, name: string, parse: (text: string) => T | undefined): Promise<Kept<T>> {
  const file = join(dataDir, name);
  const problem = await fileProblem(file, constants.R_OK);
  if (problem === "the file is missing") return { state: "none" };
  if (problem !== undefined) return { state: "bad" };
  try {
    const value = parse(await readFile(file, "utf8"));
    return value === undefined ? { state: "bad" } : { state: "ok", value };
  } catch { return { state: "bad" }; }
}

/** Each file read at most once per list, however many needs ask. */
const once = <T>(read: () => Promise<T>): (() => Promise<T>) => {
  let kept: Promise<T> | undefined;
  return () => (kept ??= read());
};

export const rankingOnce = (dataDir: string) => once(() => keptFile(dataDir, RANKING_FILE, (text) => {
  const view: unknown = JSON.parse(text);
  return isRankingView(view) ? view : undefined;
}));
