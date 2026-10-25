/**
 * The diagram check (ADR 0101, brief D10): a Mermaid diagram in a draft that draws the author's stack must match the
 * stack map (Relay's `relay graph --format json`, `relay.stack.graph/v1`): every arrow between two boxes that are parts
 * the map knows (by label, any case) must be an edge of the map, in either direction. Arrows to boxes the map does not
 * know are left alone, so concept diagrams pass. With no map configured, no diagram with boxes can be checked, and the
 * check says so instead of passing it.
 */

export interface StackGraph { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> }
export interface DiagramResult { passed: boolean; findings: string[] }

const NODE = /([A-Za-z0-9_]+)\s*(\(\[|\[\[|\[\/|\[|\(\(|\(|\{)\s*"?([^"\]\)\}]*?)"?\s*(\]\)|\]\]|\/\]|\]|\)\)|\)|\})/gu;
const EDGE = /([A-Za-z0-9_]+)(?:\s*(?:\(\[|\[\[|\[\/|\[|\(\(|\(|\{)[^\]\)\}]*(?:\]\)|\]\]|\/\]|\]|\)\)|\)|\}))?\s*(?:-{2,3}>|-\.->|-\.\s*"[^"]*"\s*\.->|={2,3}>|--\s*"[^"]*"\s*-->|-->\|[^|]*\|)\s*([A-Za-z0-9_]+)/gu;

/** The Mermaid blocks of a markdown draft. */
export const mermaidBlocks = (markdown: string): string[] => [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/gu)].map((m) => m[1]!);

/** A Mermaid flowchart's labels by node id, and its arrows (node id pairs). */
export function parseFlowchart(block: string): { labels: Map<string, string>; arrows: Array<[string, string]> } {
  const labels = new Map<string, string>();
  for (const m of block.matchAll(NODE)) if (!labels.has(m[1]!)) labels.set(m[1]!, m[3]!.trim());
  const arrows: Array<[string, string]> = [];
  for (const line of block.split("\n")) for (const m of line.matchAll(EDGE)) arrows.push([m[1]!, m[2]!]);
  return { labels, arrows };
}

const key = (text: string) => text.trim().toLowerCase();

export function checkDiagrams(markdown: string, graph: StackGraph | null): DiagramResult {
  const findings: string[] = [];
  const blocks = mermaidBlocks(markdown);
  const byLabel = new Map((graph?.nodes ?? []).map((n) => [key(n.label), n.id]));
  const edges = new Set((graph?.edges ?? []).flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]));
  blocks.forEach((block, i) => {
    const { labels, arrows } = parseFlowchart(block);
    const label = (id: string) => labels.get(id) ?? id;
    if (!graph) {
      if (labels.size > 0) findings.push(`diagram ${i + 1} cannot be checked: no stack map is configured`);
      return;
    }
    for (const [from, to] of arrows) {
      const a = byLabel.get(key(label(from))), b = byLabel.get(key(label(to)));
      if (a && b && !edges.has(`${a}>${b}`)) findings.push(`diagram ${i + 1} draws ${label(from)} → ${label(to)}, which the stack map does not have`);
    }
  });
  return { passed: findings.length === 0, findings };
}
