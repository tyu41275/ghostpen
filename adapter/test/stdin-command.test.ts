/** `runStdin`: a command the settings name, run once with one prompt on stdin (the stack map command, `draft.stackMap`). */
import { describe, expect, it } from "vitest";
import { runStdin } from "../src/command.js";

describe("a command on stdin", () => {
  it("runs the configured command with the prompt on stdin, and says why when it fails", async () => {
    const echo = { command: ["node", "-e", "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({len:s.length})))"], timeoutSeconds: 10 };
    expect(JSON.parse(await runStdin(echo, "hello", "stack map command"))).toEqual({ len: 5 });
    await expect(runStdin({ command: ["node", "-e", "console.error('relay gone');process.exit(3)"], timeoutSeconds: 10 }, "x", "stack map command"))
      .rejects.toThrow("the stack map command exited 3: relay gone");
    await expect(runStdin({ command: ["node", "-e", "setTimeout(()=>{}, 5000)"], timeoutSeconds: 1 }, "x", "stack map command")).rejects.toThrow("did not answer within 1 s");
    await expect(runStdin({ command: ["/nonexistent/relay"], timeoutSeconds: 10 }, "x", "stack map command")).rejects.toThrow("could not start");
  });
});
