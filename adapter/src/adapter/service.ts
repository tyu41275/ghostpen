/**
 * How ghostpen's adapter reaches its service (ghostpen#89): it reads the port and the adapter key file from the settings
 * file its chatter config names and calls the service's adapter routes on loopback with the key. It never opens the
 * service's files, so a slow or broken data folder cannot hold chatter up beyond the request's timeout.
 */
import { request } from "node:http";
import { readAppKey } from "../service/app-identity.js";
import { readSettings } from "../settings.js";

export const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ANSWER = 1024 * 1024;

/** One call to an adapter route; resolves the JSON answer of a 200, throws with the service's words otherwise. */
export function callAdapterRoute<T>(config: Record<string, unknown>, method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
  const settingsFile = config.settingsFile;
  if (typeof settingsFile !== "string") return Promise.reject(new Error("ghostpen adapter config needs settingsFile"));
  let port: number, key: string;
  try {
    const settings = readSettings(settingsFile);
    if (!settings.adapterKeyFile) throw new Error("the settings name no adapterKeyFile, so the adapter cannot reach ghostpen's service");
    port = settings.port;
    key = readAppKey(settings.adapterKeyFile, "adapterKeyFile").toString("base64url");
  } catch (error) {
    return Promise.reject(error);
  }
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: `/v1/adapter/${route}`, timeout: REQUEST_TIMEOUT_MS,
      headers: { authorization: `Bearer ${key}`, ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_ANSWER) req.destroy(new Error("ghostpen's service answered too much")); else chunks.push(chunk); });
      res.on("end", () => {
        let answer: Record<string, unknown> = {};
        try { answer = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { /* reported below */ }
        if (res.statusCode === 200 && answer && typeof answer === "object") resolve(answer as T);
        else reject(new Error(typeof answer?.error === "string" ? answer.error : `ghostpen's service answered HTTP ${String(res.statusCode)}`));
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`ghostpen's service did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`)));
    req.on("error", reject);
    req.end(payload);
  });
}
