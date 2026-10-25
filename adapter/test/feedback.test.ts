import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHIPS, chipOf, chipOptions } from "../src/feedback/chips.js";
import { addFeedback, contextFor, FEEDBACK_FILE, readFeedback } from "../src/feedback/store.js";
import { tempDir } from "./helpers.js";

describe("reason choices", () => {
  it("lists each press's choices with values naming the press", () => {
    expect(chipOptions(["later"])).toEqual([{ label: "Not yet: Waiting on the outcome", value: "later:0" }, { label: "Not yet: Not the right week", value: "later:1" }]);
    expect(chipOptions(["write", "skip", "later"])).toHaveLength(CHIPS.write.length + CHIPS.skip.length + CHIPS.later.length);
    expect(chipOptions(["write", "skip", "later", "publish"]).every((o) => o.label.length <= 100)).toBe(true); // Discord's option limit
  });

  it("turns a chosen value back into its press and words, refusing any other", () => {
    expect(chipOf("skip:1", ["write", "skip"])).toEqual({ action: "skip", reason: "Already covered" });
    for (const value of ["publish:0", "skip:9", "skip", "skip:-1", 3, undefined]) expect(chipOf(value, ["write", "skip"])).toBeNull();
  });
});

describe("the feedback store", () => {
  it("keeps every entry in order, waiting for the operator intake, and gives a topic's context", () => {
    const dir = tempDir();
    expect(readFeedback(dir)).toEqual([]);
    addFeedback(dir, { at: "t1", by: "1", topic: "a", kind: "reason", action: "write", chip: true, text: "  Others would find it useful " });
    addFeedback(dir, { at: "t2", by: "1", topic: "a", kind: "context", text: "This ran for a month first." });
    addFeedback(dir, { at: "t3", by: "1", topic: "b", kind: "context", text: "x".repeat(5000) });
    const entries = readFeedback(dir);
    expect(entries[0]).toEqual({ at: "t1", by: "1", topic: "a", kind: "reason", action: "write", chip: true, text: "Others would find it useful", intake: "pending" });
    expect(entries[2]!.text).toHaveLength(4000);
    expect(contextFor(dir, "a")).toEqual(["This ran for a month first."]);
    expect(contextFor(dir, "c")).toEqual([]);
  });

  it("refuses a file that is not its own, never resetting it", () => {
    const dir = tempDir();
    writeFileSync(join(dir, FEEDBACK_FILE), JSON.stringify({ version: 2 }));
    expect(() => readFeedback(dir)).toThrow("is not ghostpen's feedback file");
    expect(() => addFeedback(dir, { at: "t", by: "1", topic: "a", kind: "reason", text: "x" })).toThrow("is not ghostpen's feedback file");
  });
});
