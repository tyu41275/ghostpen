/** Starting the service: settings, the data folder and the app key are checked before it listens; any failure starts nothing. */
import type { Server } from "node:http";
import { DraftJobs } from "../publish/jobs.js";
import { RankJobs } from "../ranking/jobs.js";
import { readSettings } from "../settings.js";
import { readAppKey } from "./app-identity.js";
import { checkDataDir, createGhostpenServer } from "./server.js";

export interface RunningService { server: Server; port: number }

/** `port` overrides the settings' (0 in tests). */
export async function startService(settingsPath: string, port?: number): Promise<RunningService> {
  const started = new Date();
  const settings = readSettings(settingsPath);
  checkDataDir(settings.dataDir);
  // A key file named but unreadable or too short stops the start (pattern adapter-app); none named opens the app to nobody.
  const appKey = settings.appIdentityKeyFile ? readAppKey(settings.appIdentityKeyFile) : undefined;
  // The adapter key, like the app key: named but unreadable or short stops the start; none named closes the routes.
  const adapterKey = settings.adapterKeyFile ? readAppKey(settings.adapterKeyFile, "adapterKeyFile") : undefined;
  // Drafting runs here, one draft at a time; drafts a stopped service left unfinished start again.
  const jobs = settings.draft ? new DraftJobs(settings) : undefined;
  jobs?.resume();
  // The ranking runs here when a shortlist ask finds it due (ghostpen#118); with no scorer or no topics nothing would rank.
  const ranker = settings.scorer && settings.sources.topics.length > 0 ? new RankJobs(settings) : undefined;
  const server = createGhostpenServer({ instance: settings.instance, dataDir: settings.dataDir, settings, ...(appKey ? { appKey } : {}),
    ...(adapterKey ? { adapterKey } : {}), ...(jobs ? { jobs } : {}), ...(ranker ? { ranker } : {}), readiness: { settingsFile: settingsPath, started } });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port ?? settings.port, "127.0.0.1", resolve); });
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : settings.port };
}
