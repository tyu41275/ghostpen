import { describe, expect, it } from "vitest";
import { parseSettings, readSettings } from "../src/settings.js";
import { settingsFile, tempDir } from "./helpers.js";

describe("settings", () => {
  it("reads an instance's settings, the key file optional", () => {
    const dir = tempDir();
    expect(readSettings(settingsFile(dir))).toEqual({ instance: "personal-comms-host", port: 8794, dataDir: dir });
    expect(readSettings(settingsFile(dir, { appIdentityKeyFile: "/etc/ghostpen/app.key" })).appIdentityKeyFile).toBe("/etc/ghostpen/app.key");
  });

  it("names the field that is wrong, never its value", () => {
    const base = { instance: "x", port: 8794, dataDir: "/data" };
    expect(() => parseSettings([])).toThrow("settings: must be a JSON object");
    expect(() => parseSettings({ ...base, instance: "../x" })).toThrow("settings: instance must be a name");
    expect(() => parseSettings({ ...base, port: 80 })).toThrow("settings: port must be a whole number from 1024 to 65535");
    expect(() => parseSettings({ ...base, dataDir: "relative/dir" })).toThrow("settings: dataDir must be an absolute path");
    expect(() => parseSettings({ ...base, appIdentityKeyFile: "key" })).toThrow("settings: appIdentityKeyFile must be an absolute path");
    expect(() => readSettings("/nonexistent/settings.json")).toThrow(/settings: cannot read \/nonexistent\/settings.json/u);
  });
});
