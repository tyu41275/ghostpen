/**
 * ghostpen's chatter adapter (ADR 0101, ADR 0030). Chatter loads it only while ghostpen is allowed and switched on for
 * the instance; switching it off runs the drop-in's `stop`, which stops ghostpen's service and keeps its data. Its
 * chatter config (`ctx.config.settingsFile`) names the settings file the service reads. It contributes `status` for
 * now; nothing here may break chatter, so a ghostpen that does not answer is reported, saying why, never thrown.
 */
import { readSettings } from "../settings.js";

export const REQUEST_TIMEOUT_MS = 5_000;
/**
 * The chatter adapter API this adapter is written against, not ghostpen's own version (`src/version.ts`): chatter
 * refuses to load an adapter whose `version` is outside its `chatterAdapterApi` range (chatter docs/external-adapters.md).
 */
export const ADAPTER_API_VERSION = "1.0.0";

/** The slice of chatter's adapter context ghostpen uses. */
export interface GhostpenAdapterContext {
  config: Record<string, unknown>;
  log: (level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) => void;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the service's `/health` says, or that it did not answer and why. */
export async function health(ctx: GhostpenAdapterContext): Promise<Record<string, unknown>> {
  const settingsFile = ctx.config.settingsFile;
  if (typeof settingsFile !== "string") throw new Error("ghostpen adapter config needs settingsFile");
  const { port, instance } = readSettings(settingsFile);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    return { answering: false, error: errorText(error) };
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return { answering: false, status: response.status, ...(typeof body.error === "string" ? { error: body.error } : {}) };
  // Whatever answers on the port must be this instance's ghostpen: anything else is not ghostpen answering.
  if (body.ok !== true || body.instance !== instance || typeof body.version !== "string") {
    return { answering: false, error: `something else answers on port ${port} (not ghostpen for ${instance})` };
  }
  return { answering: true, ...body };
}

/** The `status` command's reply, in plain words (its smoke case matches the answering form, so a down service fails smoke). */
export function statusText(state: Record<string, unknown>): string {
  if (state.answering === true) return `ghostpen for ${String(state.instance)} is on and answering.`;
  const why = [state.status === undefined ? null : `HTTP ${String(state.status)}`, typeof state.error === "string" ? state.error : null]
    .filter(Boolean);
  return `ghostpen is not answering (${why.length ? why.join("; ") : "no reason given"}).`;
}

export const adapter = {
  name: "ghostpen",
  version: ADAPTER_API_VERSION,
  agentTools: [{
    name: "status",
    description: "ghostpen's state on this instance: whether its service answers, and why not when it does not.",
    parameters: { type: "object", properties: {} },
    execute: async (_args: Record<string, unknown>, ctx: GhostpenAdapterContext) => {
      try { return await health(ctx); } catch (error) { return { answering: false, error: errorText(error) }; }
    },
  }],
  commands: [{
    name: "status",
    description: "Whether ghostpen answers on this instance",
    execute: async (_request: unknown, ctx: GhostpenAdapterContext): Promise<string> => {
      try { return statusText(await health(ctx)); } catch (error) { return statusText({ answering: false, error: errorText(error) }); }
    },
  }],
};

// Chatter takes a module's `default` export as the adapter.
export default adapter;
