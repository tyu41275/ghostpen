/**
 * The diagram check (ADR 0101, brief D10): a Mermaid diagram in a draft that draws the author's stack must match the
 * stack map (Relay's `relay graph --format json`, `relay.stack.graph/v1`): every arrow between two boxes that are parts
 * the map knows (by label, any case) must be an edge of the map, in either direction. Arrows to boxes the map does not
 * know are left alone, so concept diagrams pass. With no map configured, no diagram with boxes can be checked, and the
 * check says so instead of passing it.
 */

export interface StackGraph { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> }
export interface DiagramResult { passed: boolean; findings: string[] }

/** A box: its id, then a shape (`[..]`, `(..)`, `{..}`, `((..))`, `[[..]]`, `([..])`, `{{..}}`, `>..]`, ...) round its label. */
const SHAPE = /([A-Za-z0-9_]+)\s*(?:\(\(\(|\(\(|\(\[|\[\[|\[\(|\{\{|\[\/|\[\\|\[|\(|\{|>)\s*(?:"([^"]*)"|([^\]\)\}"]*?))\s*(?:\)\)\)|\)\)|\]\)|\]\]|\)\]|\}\}|\/\]|\\\]|\]|\)|\})/gu;
/** A link with words in it (`-- words -->`, `== words ==>`, `-. words .->`), read as a plain link. */
const WORDED = /(?:--|==|-\.)\s+[^|]*?\s+(?:-{2,}[>ox]?|={2,}[>ox]?|\.-+[>ox]?)(?=\s|[A-Za-z0-9_]|$)/gu;
/**
 * A link: `-->`, `---`, `-.->`, `==>`, `--o`, `--x`, `<-->`, `o--o`, any length; `~~~` (drawn as nothing) is apart. A
 * leading `o` or `x` is a marker only after a space, so `Tempo-->Clock` keeps its box name.
 */
const LINK = /\s*(?:(?:<|(?<=\s)[ox])(?=[-=]))?(?:-{2,}|={2,}|-\.+-|~{3,})(?:>|[ox](?=\s))?\s*/u;

/** The Mermaid blocks of a markdown draft. */
export const mermaidBlocks = (markdown: string): string[] => [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/gu)].map((m) => m[1]!);

/** A Mermaid flowchart's labels by node id, and its arrows (node id pairs, every pair a chain or `&` draws). */
export function parseFlowchart(block: string): { labels: Map<string, string>; arrows: Array<[string, string]> } {
  const labels = new Map<string, string>();
  const arrows: Array<[string, string]> = [];
  for (const raw of block.split(/\n|;/u)) {
    const line = raw.replace(SHAPE, (_all, id: string, quoted?: string, plain?: string) => {
      if (!labels.has(id)) labels.set(id, (quoted ?? plain ?? "").trim());
      return id;
    }).replace(/\|[^|]*\|/gu, " ").replace(WORDED, " --> ");
    const pieces = splitLinks(line);
    for (let i = 0; i + 1 < pieces.length; i += 1) {
      if (pieces[i]!.invisible) continue;
      for (const from of pieces[i]!.ids) for (const to of pieces[i + 1]!.ids) arrows.push([from, to]);
    }
  }
  return { labels, arrows };
}

/**
 * The line's boxes between links: each piece's ids (`a & b`), and whether the link after it is invisible. A piece that is
 * not only box ids (a comment, a `classDef` or `style` line) has none, so it draws nothing.
 */
function splitLinks(line: string): Array<{ ids: string[]; invisible: boolean }> {
  const pieces: Array<{ ids: string[]; invisible: boolean }> = [];
  let rest = line;
  for (;;) {
    const m = LINK.exec(rest);
    const text = m ? rest.slice(0, m.index) : rest;
    const ids = text.split("&").map((t) => t.trim()).filter((t) => /^[A-Za-z0-9_]+$/u.test(t));
    pieces.push({ ids, invisible: !!m && m[0].includes("~") });
    if (!m) return pieces;
    rest = rest.slice(m.index + m[0].length);
  }
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
      if (labels.size > 0 || arrows.length > 0) findings.push(`diagram ${i + 1} cannot be checked: no stack map is configured`);
      return;
    }
    for (const [from, to] of arrows) {
      const a = byLabel.get(key(label(from))), b = byLabel.get(key(label(to)));
      if (a && b && !edges.has(`${a}>${b}`)) findings.push(`diagram ${i + 1} draws ${label(from)} → ${label(to)}, which the stack map does not have`);
    }
  });
  return { passed: findings.length === 0, findings };
}
