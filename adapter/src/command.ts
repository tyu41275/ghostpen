/**
 * Running an operator-named program (git, gh, a review command) as an argv, never through a shell, in a folder, with a
 * time limit. Resolves its output; rejects naming the program and its last error line, never its arguments (they can
 * hold paths). Used for publishing (ghostpen#90). `runStdin` runs a command the settings name with one prompt on stdin, in a
 * process group of its own: the scorer and the stack map command.
 */
import { execFile, spawn } from "node:child_process";

export type Run = (argv: string[], options: { cwd: string; timeoutMs?: number }) => Promise<string>;

export const runIn: Run = (argv, options) => new Promise((resolve, reject) => {
  const [command, ...args] = argv;
  execFile(command!, args, { cwd: options.cwd, timeout: options.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
    (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const last = `${stderr}`.trim().split("\n").pop() || error.message.split("\n")[0]!;
      reject(new Error(`${command!.split("/").pop()} ${args[0] ?? ""} failed: ${last.slice(0, 300)}`.trim()));
    });
});

/** A command with one prompt on stdin: argv (no shell) and its time limit. */
export interface CommandSettings { command: string[]; timeoutSeconds: number }

/** How long a timed-out command gets after SIGTERM before its whole process group is killed. */
export const KILL_GRACE_MS = 2_000;

/**
 * Runs a command the settings name (named `name` in errors: the scorer, the stack map command) once on `prompt`; resolves its
 * stdout, rejects on a failure, a timeout or a non-zero exit. It runs in a process group of its own, so a timeout stops
 * it and anything it started: SIGTERM to the group, then SIGKILL after `KILL_GRACE_MS` for whatever ignores it. Its
 * streams are closed, so nothing it left keeps ghostpen waiting.
 */
export function runStdin(settings: CommandSettings, prompt: string, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [command, ...args] = settings.command;
    const child = spawn(command!, args, { stdio: ["pipe", "pipe", "pipe"], detached: true });
    let out = "", err = "", settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const group = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already gone */ } };
    const timer = setTimeout(() => {
      group("SIGTERM");
      // Kept even once the command itself exits: a child it started may still ignore SIGTERM. A group already gone is a no-op.
      setTimeout(() => group("SIGKILL"), KILL_GRACE_MS).unref();
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
      settle(() => reject(new Error(`the ${name} did not answer within ${settings.timeoutSeconds} s`)));
    }, settings.timeoutSeconds * 1000);
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.stdin.on("error", () => { /* a command that exits without reading its prompt */ });
    child.on("error", (error) => settle(() => reject(new Error(`the ${name} could not start (${error.message})`))));
    child.on("close", (code) => settle(() => {
      if (code === 0) resolve(out);
      else reject(new Error(`the ${name} exited ${String(code)}${err.trim() ? `: ${err.trim().split("\n").pop()!.slice(0, 200)}` : ""}`));
    }));
    child.stdin.end(prompt);
  });
}
