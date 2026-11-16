/**
 * What a draft's diagrams are checked against (ghostpen#90): the stack map, the configured Mermaid
 * flowcharts (`draft.diagramFiles`), or both, joined by box label (any case). A configured source that cannot be read
 * fails closed: there is then no graph, and every diagram with boxes is named as one that cannot be checked.
 */
import { readFile } from "node:fs/promises";
import type { DraftSettings } from "../settings.js";
import { parseFlowchart, type StackGraph } from "./diagrams.js";
import { readStackMap } from "./stack-map.js";

export const NOT_FLOWCHART = "it is not a Mermaid flowchart", NO_ARROWS = "it draws no arrows";
const key = (text: string) => text.trim().toLowerCase();

/** One graph from many, each box keyed by its lower-cased label; each graph's own ids are read through its labels. */
export function mergeGraphs(graphs: StackGraph[]): StackGraph {
  const nodes = new Map<string, { id: string; label: string }>();
  const edges = new Map<string, { from: string; to: string }>();
  for (const graph of graphs) {
    const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]));
    for (const n of graph.nodes) if (!nodes.has(key(n.label))) nodes.set(key(n.label), { id: key(n.label), label: n.label.trim() });
    for (const e of graph.edges) {
      const from = key(labelOf.get(e.from) ?? e.from), to = key(labelOf.get(e.to) ?? e.to);
      edges.set(`${from}>${to}`, { from, to });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** A `.mmd` file's flowchart as a graph, or why it is not one. Comments, `%%{init}%%` and frontmatter are left out. */
export function parseDiagramFile(text: string): StackGraph {
  const lines = text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("%%"));
  if (!/^(?:flowchart|graph)(?:\s|$)/u.test(lines[0] ?? "")) throw new Error(NOT_FLOWCHART);
  const { labels, arrows } = parseFlowchart(lines.slice(1).join("\n"));
  if (arrows.length === 0) throw new Error(NO_ARROWS);
  const ids = new Set([...labels.keys(), ...arrows.flat()]);
  return mergeGraphs([{ nodes: [...ids].map((id) => ({ id, label: labels.get(id) || id })), edges: arrows.map(([from, to]) => ({ from, to })) }]);
}

/**
 * The graph a draft may draw and is checked against. `problems` go on the draft; `unread` names each configured source
 * that failed, and is never empty while a configured file fails. The map alone comes back as it is.
 */
export async function readDiagramSources(draft: DraftSettings, stackMap?: (prompt: string) => Promise<string>):
  Promise<{ graph: StackGraph | null; problems: string[]; unread: string[] }> {
  const files = draft.diagramFiles ?? [];
  const map = files.length === 0 || draft.stackMap ? await readStackMap(draft.stackMap, stackMap) : undefined;
  const mapProblems = map?.problem ? [`stack map: ${map.problem}`] : [];
  if (files.length === 0) return { graph: map!.graph, problems: mapProblems, unread: [] };
  const unread = map && !map.graph ? [`the stack map: ${map.problem ?? "it cannot be read"}`] : [];
  const graphs = map?.graph ? [map.graph] : [];
  for (const [i, file] of files.entries()) {
    let text: string;
    try { text = await readFile(file, "utf8"); } catch { unread.push(`draft.diagramFiles[${i}]: the file cannot be read`); continue; }
    try { graphs.push(parseDiagramFile(text)); } catch (error) {
      unread.push(`draft.diagramFiles[${i}]: ${error instanceof Error && error.message === NO_ARROWS ? NO_ARROWS : NOT_FLOWCHART}`);
    }
  }
  const fileProblems = unread.filter((u) => u.startsWith("draft.diagramFiles["));
  if (unread.length > 0) return { graph: null, problems: [...mapProblems, ...fileProblems], unread };
  return { graph: mergeGraphs(graphs), problems: mapProblems, unread: [] };
}
