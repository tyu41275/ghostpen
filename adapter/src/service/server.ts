/**
 * ghostpen's service on loopback (ADR 0101). `GET /health` is what chatter's Adapters page and the adapter's `status`
 * read; it checks the data folder on every request, so a folder that went away reads as down (503, saying why).
 * `/app/` opens only to a person chatter's console signed (`app-identity.ts`); anyone else finds nothing (404).
 */
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isRankingView, RANKING_FILE, type RankingView } from "../ranking/run.js";
import { createServer, type Server, type ServerResponse } from "node:http";
import { GHOSTPEN_VERSION } from "../version.js";
import { APP_CSP, renderApp } from "./app.js";
import { verifyAppIdentity } from "./app-identity.js";

export interface ServerOptions { instance: string; dataDir: string; appKey?: Buffer; now?: () => number }

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Throws, saying why, unless `dir` is a folder this process can write to. */
export function checkDataDir(dir: string): void {
  let isFolder = false;
  try { isFolder = statSync(dir).isDirectory(); } catch { /* reported below */ }
  if (!isFolder) throw new Error(`dataDir: ${dir} is not a folder`);
  try { accessSync(dir, constants.W_OK); } catch { throw new Error(`dataDir: ${dir} cannot be written`); }
}

/** The last ranking run's result, null before the first, an Error when the file cannot be read (shown, never hidden). */
function lastRanking(dataDir: string): RankingView | null | Error {
  const path = join(dataDir, RANKING_FILE);
  if (!existsSync(path)) return null;
  try {
    const view: unknown = JSON.parse(readFileSync(path, "utf8"));
    // Every entry and score is checked, so a malformed file shows as unreadable instead of failing the page.
    return isRankingView(view) ? view : new Error("it is not a ranking ghostpen wrote (an entry, score or list has the wrong shape)");
  } catch (error) {
    return new Error(error instanceof Error ? error.message.split("\n")[0]! : String(error));
  }
}

export function createGhostpenServer(options: ServerOptions): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/health") {
      if (req.method !== "GET") return send(res, 405, { error: "use GET" });
      const base = { instance: options.instance, version: GHOSTPEN_VERSION };
      try {
        checkDataDir(options.dataDir);
        return send(res, 200, { ok: true, ...base });
      } catch (error) {
        return send(res, 503, { ok: false, ...base, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (path === "/app/") {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "use GET" });
      const header = req.headers["x-chatter-identity"];
      const viewer = options.appKey && verifyAppIdentity(Array.isArray(header) ? undefined : header, options.appKey,
        (options.now ?? Date.now)());
      if (!viewer) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": APP_CSP,
        "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
      res.end(req.method === "HEAD" ? undefined : renderApp(options.instance, viewer, lastRanking(options.dataDir)));
      return;
    }
    send(res, 404, { error: "not found" });
  });
}
