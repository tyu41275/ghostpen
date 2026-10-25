/**
 * Running an operator-named program (git, gh, a review command) as an argv, never through a shell, in a folder, with a
 * time limit. Resolves its output; rejects naming the program and its last error line, never its arguments (they can
 * hold paths). Used for publishing (ghostpen#90); the scorer and writer keep their own runner (stdin prompt, process
 * group).
 */
import { execFile } from "node:child_process";

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
