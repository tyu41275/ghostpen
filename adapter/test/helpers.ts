import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A fresh folder, removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ghostpen-"));
  made.push(dir);
  return dir;
}

/** A fresh folder holding `files` (relative path to text). */
export function tree(files: Record<string, string>): string {
  const root = tempDir();
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

export const KEY = Buffer.alloc(32, 7);

/** A key file holding `key` as base64url text. */
export function keyFile(dir: string, key: Buffer = KEY): string {
  const path = join(dir, "app.key");
  writeFileSync(path, key.toString("base64url"));
  return path;
}

/** An `X-Chatter-Identity` header as chatter's console signs it. */
export function identity(claims: Record<string, unknown>, key: Buffer = KEY): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", key).update(`v1.${payload}`).digest("base64url")}`;
}

export function settingsFile(dir: string, over: Record<string, unknown> = {}): string {
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify({ instance: "personal-comms-host", port: 8794, dataDir: dir, ...over }));
  return path;
}
