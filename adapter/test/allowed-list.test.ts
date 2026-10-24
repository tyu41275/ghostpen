import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain script with no types.
import { readAllowed } from "../scripts/allowed-list.mjs";

describe("allowed-list.mjs", () => {
  it("reads the instance and its adapters, lower case, and refuses what it cannot read", () => {
    expect(readAllowed("instance: host\nadapters: [Ghostpen, tempo]\n")).toEqual({ instance: "host", adapters: ["ghostpen", "tempo"] });
    for (const [text, why] of [["[]", "not a mapping"], ["instance: host\n", "adapters: is missing"], ["instance: host\nadapters: x\n", "not a list"],
      ["instance: host\nadapters: [a, A]\n", "listed twice"], ["instance: host\ninstance: x\nadapters: []\n", "not YAML"],
      ["adapters: []\n", "instance: is missing"]] as const) {
      expect(() => readAllowed(text)).toThrow(why);
    }
  });
});
