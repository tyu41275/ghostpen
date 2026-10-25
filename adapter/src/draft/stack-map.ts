/**
 * The stack map a draft's diagrams are checked against (ADR 0101, brief D10): the output of the command in
 * `draft.stackMap` (on the author's host, `relay graph --format json`, format `relay.stack.graph/v1`). Unset, or a map
 * that cannot be read, gives no map: the diagram check then says it cannot check, never passes a diagram unchecked.
 */
import type { ScorerSettings } from "../ranking/scorer.js";
import { runScorer } from "../ranking/scorer.js";
import type { StackGraph } from "./diagrams.js";

export const STACK_MAP_FORMAT = "relay.stack.graph/v1";

/** The map in `text`, or why it is not one. */
export function parseStackMap(text: string): StackGraph {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("the stack map is not JSON"); }
  const map = value as { format?: unknown; nodes?: unknown; edges?: unknown };
  if (!map || typeof map !== "object" || map.format !== STACK_MAP_FORMAT) throw new Error(`the stack map is not ${STACK_MAP_FORMAT}`);
  const str = (v: unknown) => typeof v === "string" && v !== "";
  const nodes = Array.isArray(map.nodes) ? map.nodes as Array<Record<string, unknown>> : null;
  const edges = Array.isArray(map.edges) ? map.edges as Array<Record<string, unknown>> : null;
  if (!nodes || !edges || !nodes.every((n) => n && str(n.id) && str(n.label)) || !edges.every((e) => e && str(e.from) && str(e.to))) {
    throw new Error("the stack map's nodes or edges are not the right shape");
  }
  return { nodes: nodes.map((n) => ({ id: n.id as string, label: n.label as string })), edges: edges.map((e) => ({ from: e.from as string, to: e.to as string })) };
}

export async function readStackMap(settings: ScorerSettings | undefined,
  run: (prompt: string) => Promise<string> = (prompt) => runScorer(settings!, prompt, "stack map command")):
  Promise<{ graph: StackGraph | null; problem?: string }> {
  if (!settings) return { graph: null, problem: "no stack map is configured (settings.draft.stackMap)" };
  try { return { graph: parseStackMap(await run("")) }; } catch (error) {
    return { graph: null, problem: error instanceof Error ? error.message : String(error) };
  }
}
