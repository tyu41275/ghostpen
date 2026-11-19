import { describe, expect, it } from "vitest";
import { parseSettings, readSettings, scorerTimeoutMs } from "../src/settings.js";
import { settingsFile, tempDir } from "./helpers.js";

describe("settings", () => {
  it("reads an instance's settings, the key file optional", () => {
    const dir = tempDir();
    expect(readSettings(settingsFile(dir))).toEqual({ instance: "instance-a", port: 8794, dataDir: dir, sources: { topics: [], references: [] } });
    expect(readSettings(settingsFile(dir, { appIdentityKeyFile: "/etc/ghostpen/app.key" })).appIdentityKeyFile).toBe("/etc/ghostpen/app.key");
  });

  it("names the field that is wrong, never its value", () => {
    const base = { instance: "x", port: 8794, dataDir: "/data" };
    expect(() => parseSettings([])).toThrow("settings: must be a JSON object");
    expect(() => parseSettings({ ...base, instance: "../x" })).toThrow("settings: instance must be a name");
    expect(() => parseSettings({ ...base, port: 80 })).toThrow("settings: port must be a whole number from 1024 to 65535");
    expect(() => parseSettings({ ...base, dataDir: "relative/dir" })).toThrow("settings: dataDir must be an absolute path");
    expect(() => parseSettings({ ...base, appIdentityKeyFile: "key" })).toThrow("settings: appIdentityKeyFile must be an absolute path");
    expect(() => readSettings("/nonexistent/settings.json")).toThrow(/^settings: the settings file cannot be read as JSON$/u);
  });

  it("reads draft.writer with or without the command older settings carry, ignoring the command (ghostpen#146)", () => {
    const base = { instance: "x", port: 8794, dataDir: "/data" };
    expect(parseSettings({ ...base, draft: { writer: { timeoutSeconds: 600 } } }).draft?.writer).toEqual({ timeoutSeconds: 600 });
    expect(parseSettings({ ...base, draft: { writer: { command: ["claude", "-p"], timeoutSeconds: 600 } } }).draft?.writer).toEqual({ timeoutSeconds: 600 });
    expect(parseSettings({ ...base, draft: { writer: { command: [] } } }).draft?.writer).toEqual({ timeoutSeconds: 900 });
    expect(parseSettings({ ...base, draft: {} }).draft?.writer).toEqual({ timeoutSeconds: 900 });
  });

  it("reads scorer as its turn's time, tolerating and ignoring the command older settings carry (ghostpen#146)", () => {
    const base = { instance: "x", port: 8794, dataDir: "/data" };
    expect(parseSettings({ ...base, scorer: { timeoutSeconds: 600 } }).scorer).toEqual({ timeoutSeconds: 600 });
    expect(parseSettings({ ...base, scorer: {} }).scorer).toEqual({ timeoutSeconds: 300 });
    // The chatter-loaded adapter of an older install still refuses a scorer without a command: installs keep it, and it is ignored.
    expect(parseSettings({ ...base, scorer: { command: ["claude", "-p"] } }).scorer).toEqual({ timeoutSeconds: 300 });
    expect(parseSettings({ ...base, scorer: { command: [] } }).scorer).toEqual({ timeoutSeconds: 300 });
    expect(() => parseSettings({ ...base, scorer: { timeoutSeconds: 5 } })).toThrow("settings: scorer.timeoutSeconds must be 10 to 3600");
    expect(() => parseSettings({ ...base, scorer: { command: ["c"], timeoutSeconds: 3601 } })).toThrow("settings: scorer.timeoutSeconds must be 10 to 3600");
    expect(() => parseSettings({ ...base, scorer: ["claude"] })).toThrow("settings: scorer must be an object");
    // A turn gets at most chatter's 30 minutes, whatever the setting says.
    expect(scorerTimeoutMs({ timeoutSeconds: 300 })).toBe(300_000);
    expect(scorerTimeoutMs({ timeoutSeconds: 3600 })).toBe(30 * 60_000);
  });
});
