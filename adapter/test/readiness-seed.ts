/** A ghostpen as the install leaves it, over real folders, and its readiness list read as the route reads it, on an injected clock. */
import { chmodSync, mkdirSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAppKey } from "../src/service/app-identity.js";
import { readinessList, type ReadinessList } from "../src/service/readiness.js";
import { readSettings } from "../src/settings.js";
import { KEY, settingsFile, tempDir } from "./helpers.js";

/** A Monday, at the default shortlist slot. */
export const STARTED = new Date("2026-11-02T09:00:00.000Z");
export const after = (ms: number) => new Date(STARTED.getTime() + ms);
export const MINUTE = 60_000;
export const ADAPTER_KEY = Buffer.alloc(32, 3);

export interface ListAt { now?: Date }

/** The four settings the install writes, and `extra`. `read(id, at)` is one need of the list as of `at.now`. */
export function installed(extra: Record<string, unknown> = {}) {
  const config = tempDir(), dataDir = tempDir();
  const appIdentityKeyFile = join(config, "app.key"), adapterKeyFile = join(config, "adapter.key");
  writeFileSync(appIdentityKeyFile, `${KEY.toString("base64url")}\n`, { mode: 0o600 });
  writeFileSync(adapterKeyFile, ADAPTER_KEY.toString("base64url"), { mode: 0o600 });
  const file = settingsFile(config, { dataDir, appIdentityKeyFile, adapterKeyFile, ...extra });
  const settings = readSettings(file);
  const appKey = readAppKey(appIdentityKeyFile), adapterKey = readAppKey(adapterKeyFile, "adapterKeyFile");
  const list = (at: ListAt = {}): Promise<ReadinessList> => readinessList({ settings, settingsFile: file, appKey, adapterKey, started: STARTED,
    now: () => at.now ?? after(MINUTE) });
  const read = async (id: string, at?: ListAt) => (await list(at)).needs.find((need) => need.id === id)!;
  return { config, dataDir, appIdentityKeyFile, adapterKeyFile, file, settings, list, read };
}

/** A list over exactly `over` (no key files unless named), read from a settings file. */
export function bare(over: Record<string, unknown> = {}) {
  const config = tempDir();
  const file = settingsFile(config, { dataDir: tempDir(), ...over });
  const settings = readSettings(file);
  return async (id: string, at: ListAt = {}) => (await readinessList({ settings, settingsFile: file, started: STARTED,
    now: () => at.now ?? after(MINUTE) })).needs.find((need) => need.id === id)!;
}

/** A folder holding a program named `name` with `mode`; for PATH. */
export function programIn(name: string, mode = 0o755, dir = tempDir()): string {
  const file = join(dir, name);
  writeFileSync(file, "#!/bin/sh\n", { mode });
  chmodSync(file, mode);
  return dir;
}

/** A markdown folder that reads. */
export function folder(): string {
  const dir = tempDir();
  mkdirSync(join(dir, "notes"));
  return dir;
}

/** Every entry under `dir` with its size and mtime: what a read must leave as it was. */
export function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((name) => {
    const found = statSync(join(dir, name));
    return `${name} ${found.size} ${found.mtimeMs}`;
  });
}
