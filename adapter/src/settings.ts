/**
 * One instance's ghostpen settings (ADR 0101). Written from the operator's own config: every machine-specific value
 * lives here, never in code. Every error names the field, never the value.
 */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ScorerSettings } from "./ranking/scorer.js";
import { checkSlot, type Slot } from "./shortlist/schedule.js";
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
  /** The key the chatter adapter sends on its routes (base64url, at least 32 bytes); unset: the routes answer 404. */
  adapterKeyFile?: string;
  /** chatter's instance facts (its `instance-facts.json`): where the channel chatter made for ghostpen is read. */
  instanceFactsFile?: string;
  /** The weekly shortlist (adapter/docs/shortlist.md); unset: none is posted. */
  shortlist?: ShortlistSettings;
  /** The draft writer (adapter/docs/drafting.md); unset: a Write is kept but nothing is drafted. */
  draft?: DraftSettings;
}

export interface DraftSettings {
  /** The command that writes a draft (argv, no shell; `timeoutSeconds` 10 to 3600, default 900). */
  writer: ScorerSettings;
  /** A writing style guide (a markdown file); unset: the published posts alone set the voice. */
  styleGuide?: string;
  /** How many recent published posts the writer reads for the author's voice (0 to 5, default 2). */
  voicePosts: number;
  /** The command that prints the stack map (`relay graph --format json`); unset: diagrams cannot be checked. */
  stackMap?: ScorerSettings;
  /** How many times a failed draft is sent back with the check report (0 to 3, default 2). */
  revisions: number;
}

export interface ShortlistSettings extends Slot {
  /** The one person whose presses count (a Discord user id). */
  operator: string;
  /** Where to post (a channel id); unset: the channel chatter made for ghostpen. */
  channel?: string;
  /** How many proposals a week (3 to 5, default 5). */
  count: number;
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
  if (value.adapterKeyFile !== undefined) settings.adapterKeyFile = absolute(value.adapterKeyFile, "adapterKeyFile");
  if (value.instanceFactsFile !== undefined) settings.instanceFactsFile = absolute(value.instanceFactsFile, "instanceFactsFile");
  if (value.shortlist !== undefined) settings.shortlist = parseShortlist(value.shortlist);
  if (value.draft !== undefined) settings.draft = parseDraft(value.draft);
  if (value.appIdentityKeyFile !== undefined) settings.appIdentityKeyFile = absolute(value.appIdentityKeyFile, "appIdentityKeyFile");
  return settings;
}

/** `scorer` (and every other command): `command` (argv, run without a shell) and `timeoutSeconds` (10 to 3600). */
function parseScorer(raw: unknown, field = "scorer", defaultTimeout = 300): ScorerSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`settings: ${field} must be an object`);
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.command) || value.command.length === 0 || !value.command.every((a) => typeof a === "string" && a !== "")) {
    throw new Error(`settings: ${field}.command must be a non-empty list of strings`);
  }
  const timeout = value.timeoutSeconds ?? defaultTimeout;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 10 || timeout > 3600) {
    throw new Error(`settings: ${field}.timeoutSeconds must be 10 to 3600`);
  }
  return { command: value.command as string[], timeoutSeconds: timeout };
}

/** `shortlist`: `operator` (required), optional `channel`, and the slot (`day` monday, `time` 09:00, `timeZone` UTC by default). */
function parseShortlist(raw: unknown): ShortlistSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("settings: shortlist must be an object");
  const value = raw as Record<string, unknown>;
  if (typeof value.operator !== "string" || !/^\d{5,25}$/u.test(value.operator)) throw new Error("settings: shortlist.operator must be a Discord user id");
  if (value.channel !== undefined && (typeof value.channel !== "string" || !/^\d{5,25}$/u.test(value.channel))) {
    throw new Error("settings: shortlist.channel must be a channel id");
  }
  const count = value.count ?? 5;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 3 || count > 5) throw new Error("settings: shortlist.count must be 3 to 5");
  const slot = checkSlot(value.day ?? "monday", value.time ?? "09:00", value.timeZone ?? "UTC");
  return { ...slot, operator: value.operator, count, ...(value.channel ? { channel: value.channel as string } : {}) };
}

const whole = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`settings: ${field} must be ${min} to ${max}`);
  return value;
};

/** `draft`: `writer` (required), optional `styleGuide` and `stackMap`, `voicePosts` (default 2), `revisions` (default 2). */
function parseDraft(raw: unknown): DraftSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("settings: draft must be an object");
  const value = raw as Record<string, unknown>;
  const draft: DraftSettings = { writer: parseScorer(value.writer, "draft.writer", 900), voicePosts: whole(value.voicePosts ?? 2, "draft.voicePosts", 0, 5),
    revisions: whole(value.revisions ?? 2, "draft.revisions", 0, 3) };
  if (value.styleGuide !== undefined) draft.styleGuide = absolute(value.styleGuide, "draft.styleGuide");
  if (value.stackMap !== undefined) draft.stackMap = parseScorer(value.stackMap, "draft.stackMap", 60);
  return draft;
}
