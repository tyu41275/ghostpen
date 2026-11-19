/**
 * How a timed-out command (`runStdin`: the stack map command) and the children it started are stopped
 * (process groups, KILL_GRACE_MS). Each case waits out a real timeout and the kill grace, seconds each, so this runs
 * with the slow tests, not on every PR.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KILL_GRACE_MS, runStdin } from "../src/command.js";
import { tempDir } from "./helpers.js";

describe("a command on stdin (the stack map command)", () => {
  it("stops a timed-out command that ignores SIGTERM, and the child it started, so nothing keeps running", async () => {
    const dir = tempDir(), pids = join(dir, "pids");
    // The command ignores SIGTERM and starts a child that ignores it too; both write their pid.
    const script = `const fs=require('fs');process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},process.pid+' '+c.pid);setInterval(()=>{},1000)`;
    const started = Date.now();
    await expect(runStdin({ command: ["node", "-e", script], timeoutSeconds: 1 }, "x", "stack map command")).rejects.toThrow("the stack map command did not answer within 1 s");
    expect(Date.now() - started).toBeLessThan(5_000);
    await new Promise((done) => setTimeout(done, KILL_GRACE_MS + 1_000));
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const pid of readFileSync(pids, "utf8").split(" ").map(Number)) expect(alive(pid)).toBe(false);
  }, 15_000);

  it("still kills a child that ignores SIGTERM after the command itself exited on it", async () => {
    const dir = tempDir(), pids = join(dir, "pids");
    // The command dies on SIGTERM (the default); the child it started ignores it.
    const script = `const fs=require('fs');const c=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},String(c.pid));setInterval(()=>{},1000)`;
    await expect(runStdin({ command: ["node", "-e", script], timeoutSeconds: 1 }, "x", "stack map command")).rejects.toThrow("the stack map command did not answer within 1 s");
    await new Promise((done) => setTimeout(done, KILL_GRACE_MS + 1_000));
    const child = Number(readFileSync(pids, "utf8"));
    expect((() => { try { process.kill(child, 0); return true; } catch { return false; } })()).toBe(false);
  }, 15_000);
});
