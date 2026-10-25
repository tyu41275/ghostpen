/** Starting the service: settings, the data folder and the app key are checked before it listens; any failure starts nothing. */
import type { Server } from "node:http";
import { readSettings } from "../settings.js";
import { readAppKey } from "./app-identity.js";
import { checkDataDir, createGhostpenServer } from "./server.js";

export interface RunningService { server: Server; port: number }

/** `port` overrides the settings' (0 in tests). */
export async function startService(settingsPath: string, port?: number): Promise<RunningService> {
  const settings = readSettings(settingsPath);
  checkDataDir(settings.dataDir);
  // A key file named but unreadable or too short stops the start (pattern adapter-app); none named opens the app to nobody.
  const appKey = settings.appIdentityKeyFile ? readAppKey(settings.appIdentityKeyFile) : undefined;
  // The adapter key, like the app key: named but unreadable or short stops the start; none named closes the routes.
  const adapterKey = settings.adapterKeyFile ? readAppKey(settings.adapterKeyFile, "adapterKeyFile") : undefined;
  const server = createGhostpenServer({ instance: settings.instance, dataDir: settings.dataDir, settings, ...(appKey ? { appKey } : {}),
    ...(adapterKey ? { adapterKey } : {}) });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port ?? settings.port, "127.0.0.1", resolve); });
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : settings.port };
}
