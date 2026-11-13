/**
 * `GET /readiness` (adapter/docs/readiness.md): what ghostpen needs and the state of each, in version 1 of chatter's
 * format (chatter docs/adapter-readiness.md). Read with no key, so it holds no value of a setting, only its name. It reads
 * settings and local files only: it writes nothing, spends nothing and calls nothing outside (no GitHub, gh, scorer or
 * writer). A need that throws or does not answer is that need's failure, not the list's: chatter takes a list whole or
 * not at all, so it always gets one with every need.
 */
import type { GhostpenSettings } from "../settings.js";
import { failing, type Facts, line, type Need, rankingOnce, type Reading, shortlistsOnce } from "./readiness-reading.js";
import { JOB_NEEDS } from "./readiness-jobs.js";
import { SCORER_NEED, SETTING_NEEDS } from "./readiness-settings.js";
import { SOURCE_NEEDS } from "./readiness-sources.js";

export const READINESS_PATH = "/readiness";
/** Chatter gives the whole list 5 s; a need on a disk that hung never answers, and the list goes on without it. */
export const NEED_LIMIT_MS = 4_000;
export const NEEDS: readonly Need[] = [...SETTING_NEEDS, ...SOURCE_NEEDS, SCORER_NEED, ...JOB_NEEDS];

/** Which need answers for each setting: a setting added to GhostpenSettings does not compile until it is named here. */
export const NEED_OF_SETTING: Record<keyof GhostpenSettings, string> = {
  instance: "settings-file", port: "settings-file", dataDir: "data-dir", appIdentityKeyFile: "app-identity", adapterKeyFile: "adapter-key",
  instanceFactsFile: "channel", sources: "topic-sources", scorer: "scorer", shortlist: "weekly-shortlist", draft: "drafting", publish: "publishing",
};

/**
 * What the running service hands the route: the settings it started on, the file they came from (none when started
 * without one), the keys it holds, when it started and when the adapter key last came with a call.
 */
export interface ReadinessOptions {
  settings: GhostpenSettings; settingsFile?: string | undefined; appKey?: Buffer | undefined; adapterKey?: Buffer | undefined;
  started: Date; lastKeyedCall?: Date | undefined; now?: () => Date;
}
export type ReadinessList = { version: 1; needs: Array<Omit<Need, "check"> & Reading> };

/** One need's reading. It never rejects: what threw reads `failing`, and what has not answered by `limitMs` reads `failing` saying so. */
export async function reading(need: Need, facts: Facts, limitMs = NEED_LIMIT_MS): Promise<Reading> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<Reading>((resolve) => {
    timer = setTimeout(() => resolve(failing(`this did not answer within ${limitMs / 1000} s`, facts.now.getTime())), limitMs);
  });
  try {
    const read = await Promise.race([Promise.resolve().then(() => need.check(facts)), late]);
    return { ...read, why: line(read.why), ...(read.fix === undefined ? {} : { fix: line(read.fix) }) };
  } catch {
    // An error's own words can hold a path or a piece of a file, so they are never said.
    return failing("this could not be checked", facts.now.getTime());
  } finally { clearTimeout(timer); }
}

/** The list as of now. It never rejects, and writes nothing. */
export async function readinessList(options: ReadinessOptions): Promise<ReadinessList> {
  const { settings } = options;
  const facts: Facts = { settings, settingsFile: options.settingsFile, appKey: options.appKey, adapterKey: options.adapterKey,
    now: options.now?.() ?? new Date(), started: options.started, lastKeyedCall: options.lastKeyedCall,
    ranking: rankingOnce(settings.dataDir), shortlists: shortlistsOnce(settings.dataDir) };
  const needs = await Promise.all(NEEDS.map(async (need) => {
    const { id, label, kind, required, spends, fix } = need;
    return { id, label, kind, required, spends, fix, ...(await reading(need, facts)) };
  }));
  return { version: 1, needs };
}
