/**
 * The needs that are settings (`readiness.ts`). What the install writes for every instance is required, so a list with
 * one of them `not_set_up` stops chatter's switch-on: the settings file, the data folder and the two keys. The channel
 * and the scorer are the operator's to add. Every reason names the setting, never what it holds.
 */
import { constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { parseSettings, type GhostpenSettings } from "../settings.js";
import { parseAppKey } from "./app-identity.js";
import { chosenOff, failing, type Facts, fileProblem, folderProblem, type Need, notSetUp, programProblem, type Reading, timeOf, working } from "./readiness-reading.js";

export const INSTALL = "Run ghostpen's install for this instance through Relay; it writes this.";
export const RESTART = "Restart ghostpen's service, which takes up the file.";
export const RANK = "node dist/cli/rank.js <settings>";
const needed = { kind: "setting", required: true, spends: "none" } as const;
const ON_COPY = "so the service runs on the copy it started with";

/** The settings file as it stands beside the settings the service runs on. Its words are never quoted: a parser's message holds a piece of them. */
async function fileReading(f: Facts, file: string): Promise<Reading> {
  const problem = await fileProblem(file, constants.R_OK);
  if (problem !== undefined) return failing(`the settings file: ${problem}, ${ON_COPY}`, f.now.getTime());
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, "utf8")); } catch { return failing(`the settings file is not JSON, ${ON_COPY}`, f.now.getTime()); }
  let now: GhostpenSettings;
  // The parser's own messages name the field, never its value (src/settings.ts).
  try { now = parseSettings(raw); } catch (error) {
    const said = error instanceof Error && /^settings: [A-Za-z][\w.[\]]* /u.test(error.message) ? error.message.slice("settings: ".length) : "a setting is wrong";
    return failing(`the settings file does not pass its checks (${said}), ${ON_COPY}`, f.now.getTime());
  }
  return isDeepStrictEqual(now, f.settings) ? working("the settings file reads, passes its checks and is what the service runs on", f.started.getTime())
    : failing("the settings file changed after the service started, and it runs on the copy it started with until it restarts", f.now.getTime(), RESTART);
}

/** A key file (`appIdentityKeyFile` or `adapterKeyFile`): set, a key `parseAppKey` takes, and the one the service holds. Read without blocking. */
async function keyReading(f: Facts, field: "appIdentityKeyFile" | "adapterKeyFile", held: Buffer | undefined, unset: string, good: string): Promise<Reading> {
  const file = f.settings[field];
  if (file === undefined) return notSetUp(`${field} is not set, so ${unset}`, f);
  const problem = await fileProblem(file, constants.R_OK);
  if (problem !== undefined) return failing(`${field}: ${problem}`, f.now.getTime());
  let key: Buffer;
  // parseAppKey's messages name the field, never the path or the key.
  try { key = parseAppKey(await readFile(file, "utf8"), field); } catch (error) {
    return failing(error instanceof Error && error.message.startsWith(`${field}: `) ? error.message : `${field}: it cannot be used`, f.now.getTime());
  }
  return held !== undefined && key.equals(held) ? working(good, f.started.getTime())
    : failing(`${field} holds another key than the one the service started with, which it uses until it restarts`, f.now.getTime(), RESTART);
}

/** Where the shortlist goes: the setting, else the channel chatter made for ghostpen, from its instance facts. */
async function channelReading(f: Facts): Promise<Reading> {
  if (f.settings.shortlist?.channel !== undefined) return working("shortlist.channel names ghostpen's channel", f.started.getTime());
  const file = f.settings.instanceFactsFile;
  if (file === undefined) return notSetUp("neither shortlist.channel nor instanceFactsFile is set, so ghostpen has no channel to post in", f);
  const problem = await fileProblem(file, constants.R_OK);
  if (problem !== undefined) return failing(`instanceFactsFile: ${problem}`, f.now.getTime());
  let facts: { adapterChannels?: Record<string, { channelId?: unknown } | undefined> };
  try { facts = JSON.parse(await readFile(file, "utf8")) as typeof facts; } catch { return failing("instanceFactsFile: it is not JSON", f.now.getTime()); }
  const id = facts?.adapterChannels?.ghostpen?.channelId;
  return typeof id === "string" && id !== "" ? working("chatter's instance facts name ghostpen's channel", f.started.getTime())
    : failing("chatter's instance facts name no channel for ghostpen yet", f.now.getTime(),
      "Switch ghostpen on from chatter's Adapters page, which makes its channel, or add shortlist.channel to ghostpen's kept settings (adapter/docs/shortlist.md).");
}

export const SETTING_NEEDS: Need[] = [
  { ...needed, id: "settings-file", label: "Settings file", fix: INSTALL,
    check: (f) => (f.settingsFile === undefined ? notSetUp("this service was started without a settings file", f) : fileReading(f, f.settingsFile)) },
  { ...needed, id: "data-dir", label: "Data folder", fix: INSTALL,
    check: async (f) => {
      const problem = await folderProblem(f.settings.dataDir, constants.R_OK | constants.W_OK | constants.X_OK);
      return problem === undefined ? working("the data folder (dataDir) can be written", f.started.getTime()) : failing(`dataDir: ${problem}`, f.now.getTime());
    } },
  { ...needed, id: "app-identity", label: "App page key", fix: INSTALL,
    check: (f) => keyReading(f, "appIdentityKeyFile", f.appKey, "ghostpen's app page opens to nobody", "the app page's key reads and is the one the service holds") },
  { ...needed, id: "adapter-key", label: "Adapter key", fix: INSTALL,
    check: (f) => keyReading(f, "adapterKeyFile", f.adapterKey, "chatter's adapter cannot reach the shortlist and draft routes", "the adapter key reads and is the one the service holds") },
  { id: "channel", label: "ghostpen's channel", kind: "setting", required: false, spends: "none",
    fix: "Add instanceFactsFile to ghostpen's kept settings (adapter/docs/shortlist.md), then restart ghostpen's service.", check: channelReading },
];

/** The scorer spends usage (a model run per changed topic), so it is off until the operator adds it. */
export const SCORER_NEED: Need = {
  id: "scorer", label: "Topic scorer", kind: "setting", required: false, spends: "usage",
  fix: "Add scorer to ghostpen's kept settings (adapter/docs/ranking.md), then restart ghostpen's service.",
  check: async (f) => {
    const scorer = f.settings.scorer;
    if (scorer === undefined) return chosenOff("scorer is not set, so nothing is scored or ranked", f);
    const problem = await programProblem(scorer.command[0]!);
    if (problem !== undefined) return failing(`scorer.command[0]: ${problem}`, f.now.getTime());
    const kept = await f.ranking();
    const failures = kept.state === "ok" ? kept.value.problems.filter((p) => p.startsWith("scorer: ")).length : 0;
    if (kept.state === "ok" && failures > 0) {
      const at = timeOf(kept.value.ranAt);
      return failing(`the last ranking, at ${at === undefined ? "an unknown time" : new Date(at).toISOString()}, has ${failures} scorer ${failures === 1 ? "failure" : "failures"}`,
        at ?? f.now.getTime(), `Read them on ghostpen's app page, correct the scorer, then rank again: ${RANK}.`);
    }
    return working("scorer.command[0] can be run", f.started.getTime());
  },
};
