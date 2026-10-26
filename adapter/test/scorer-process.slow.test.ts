/**
 * How a timed-out scorer and the children it started are stopped (process groups, KILL_GRACE_MS). Each case waits out
 * a real timeout and the kill grace, seconds each, so this runs with the slow tests (ADR 0028), not on every PR.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KILL_GRACE_MS, runScorer } from "../src/ranking/scorer.js";
import { tempDir } from "./helpers.js";

describe("the scorer process", () => {
  it("stops a timed-out scorer that ignores SIGTERM, and the child it started, so nothing keeps running", async () => {
    const dir = tempDir(), pids = join(dir, "pids");
    // The scorer ignores SIGTERM and starts a child that ignores it too; both write their pid.
    const script = `const fs=require('fs');process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},process.pid+' '+c.pid);setInterval(()=>{},1000)`;
    const started = Date.now();
    await expect(runScorer({ command: ["node", "-e", script], timeoutSeconds: 1 }, "x")).rejects.toThrow("did not answer within 1 s");
    expect(Date.now() - started).toBeLessThan(5_000);
    await new Promise((done) => setTimeout(done, KILL_GRACE_MS + 1_000));
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const pid of readFileSync(pids, "utf8").split(" ").map(Number)) expect(alive(pid)).toBe(false);
  }, 15_000);

  it("still kills a child that ignores SIGTERM after the scorer itself exited on it", async () => {
    const dir = tempDir(), pids = join(dir, "pids");
    // The scorer dies on SIGTERM (the default); the child it started ignores it.
    const script = `const fs=require('fs');const c=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},String(c.pid));setInterval(()=>{},1000)`;
    await expect(runScorer({ command: ["node", "-e", script], timeoutSeconds: 1 }, "x")).rejects.toThrow("did not answer within 1 s");
    await new Promise((done) => setTimeout(done, KILL_GRACE_MS + 1_000));
    const child = Number(readFileSync(pids, "utf8"));
    expect((() => { try { process.kill(child, 0); return true; } catch { return false; } })()).toBe(false);
  }, 15_000);
});
