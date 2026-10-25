/**
 * One instance's ghostpen settings (ADR 0101). Written from the operator's own config: every machine-specific value
 * lives here, never in code. Every error names the field, never the value.
 */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ScorerSettings } from "./ranking/scorer.js";
import { parseSources, type SourcesSettings } from "./sources/config.js";

export interface GhostpenSettings {
  /** The chatter instance this ghostpen belongs to. */
  instance: string;
  /** The service's loopback port (1024 to 65535): its health and app, which chatter and the adapter read. */
  port: number;
  /** Absolute folder for ghostpen's own state (rankings, Tim's picks and skips); it must already exist. */
  dataDir: string;
  /**
   * The app identity key file chatter's console signs with (ADR 0030, pattern `adapter-app`): base64url text of at
   * least 32 bytes. Unset: the app opens to nobody.
   */
  appIdentityKeyFile?: string;
  /** What ghostpen reads (adapter/docs/sources.md); none configured: nothing to rank yet. */
  sources: SourcesSettings;
  /** The command that proposes scores (adapter/docs/ranking.md); unset: ghostpen ranks nothing. */
  scorer?: ScorerSettings;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

function absolute(value: unknown, field: string): string {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`settings: ${field} must be an absolute path`);
  return value;
}

/** Reads and checks a settings file. */
export function readSettings(path: string): GhostpenSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("settings: the settings file cannot be read as JSON"); // its path is the caller's argument, never repeated here
  }
  return parseSettings(raw);
}

/** Checks parsed settings (`readSettings` without the file). */
export function parseSettings(raw: unknown): GhostpenSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("settings: must be a JSON object");
  const value = raw as Record<string, unknown>;
  if (typeof value.instance !== "string" || !NAME.test(value.instance)) throw new Error("settings: instance must be a name");
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) {
    throw new Error("settings: port must be a whole number from 1024 to 65535");
  }
  const settings: GhostpenSettings = { instance: value.instance, port: value.port, dataDir: absolute(value.dataDir, "dataDir"),
    sources: parseSources(value.sources) };
  if (value.scorer !== undefined) settings.scorer = parseScorer(value.scorer);
  if (value.appIdentityKeyFile !== undefined) settings.appIdentityKeyFile = absolute(value.appIdentityKeyFile, "appIdentityKeyFile");
  return settings;
}

/** `scorer`: `command` (argv, run without a shell) and `timeoutSeconds` (10 to 3600, default 300). */
function parseScorer(raw: unknown): ScorerSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("settings: scorer must be an object");
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.command) || value.command.length === 0 || !value.command.every((a) => typeof a === "string" && a !== "")) {
    throw new Error("settings: scorer.command must be a non-empty list of strings");
  }
  const timeout = value.timeoutSeconds ?? 300;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 10 || timeout > 3600) {
    throw new Error("settings: scorer.timeoutSeconds must be 10 to 3600");
  }
  return { command: value.command as string[], timeoutSeconds: timeout };
}
