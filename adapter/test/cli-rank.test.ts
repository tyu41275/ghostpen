/** `node dist/cli/rank.js` ranks nothing (ghostpen#146): the scorer is a model turn chatter runs for the service. */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); });

describe("the rank command", () => {
  it("refuses in plain words, saying the service ranks on its own and retries, and exits 1", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../src/cli/rank.js");
    expect(exit).toHaveBeenCalledWith(1);
    expect(said).toHaveBeenCalledTimes(1);
    const text = String(said.mock.calls[0]![0]);
    expect(text).toBe("ghostpen rank: rankings run in ghostpen's service, which asks chatter to run the scorer, so this command cannot rank. "
      + "The service ranks on its own before each weekly shortlist, and tries a failed ranking again 60 minutes after it failed at the soonest; "
      + "its app page shows the last ranking and the last try.");
  });
});
