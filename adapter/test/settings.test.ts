import { describe, expect, it } from "vitest";
import { parseSettings, readSettings } from "../src/settings.js";
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
});
