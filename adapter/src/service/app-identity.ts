/**
 * The person chatter's console vouches for when it serves ghostpen's app (chatter docs/optional-adapters.md, "The apps"):
 * `X-Chatter-Identity: v1.<payload>.<mac>`, the payload base64url JSON `{aud, login, sub, iat, exp}`, the mac base64url
 * HMAC-SHA256 over `v1.<payload>` with the shared key (the decoded base64url text of the app identity key file).
 * ghostpen opens its app only to a header whose mac, audience (`ghostpen`) and expiry check out.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const APP_AUDIENCE = "ghostpen";

export interface AppViewer { login: string; sub: string }

/** The key in `file`: base64url text of at least 32 bytes; anything else refuses to start. */
export function readAppKey(file: string): Buffer {
  const text = readFileSync(file, "utf8").trim();
  const key = /^[A-Za-z0-9_-]{43,}={0,2}$/u.test(text) ? Buffer.from(text.replace(/=+$/u, ""), "base64url") : Buffer.alloc(0);
  if (key.length < 32) throw new Error(`app identity key file ${file} must hold base64url text of at least 32 bytes`);
  return key;
}

/** The viewer a header names, or undefined when it is missing, malformed, signed with another key, for another app or expired. */
export function verifyAppIdentity(header: string | undefined, key: Buffer, nowMs = Date.now()): AppViewer | undefined {
  const parts = (header ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return undefined;
  const expected = createHmac("sha256", key).update(`v1.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const now = nowMs / 1000;
  if (claims?.aud !== APP_AUDIENCE || typeof claims.login !== "string" || typeof claims.sub !== "string"
    || typeof claims.exp !== "number" || typeof claims.iat !== "number" || claims.exp < now || claims.iat > now + 60) return undefined;
  return { login: claims.login, sub: claims.sub };
}
