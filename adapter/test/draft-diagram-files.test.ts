import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDraft } from "../src/draft/checks.js";
import { mergeGraphs, parseDiagramFile, readDiagramSources } from "../src/draft/diagram-files.js";
import { checkDiagrams } from "../src/draft/diagrams.js";
import { parseStackMap, STACK_MAP_FORMAT } from "../src/draft/stack-map.js";
import { parseSettings, type DraftSettings } from "../src/settings.js";
import { tempDir, tree } from "./helpers.js";

/** Relay's ids are not its labels, so a merged graph (keyed by label) differs from the map handed back as it is. */
const MAP = JSON.stringify({ format: STACK_MAP_FORMAT, nodes: [{ id: "n1", label: "chatter" }, { id: "n2", label: "Clock" }, { id: "n3", label: "Tempo" }],
  edges: [{ from: "n1", to: "n2" }, { from: "n1", to: "n3" }] });
const md = (block: string) => `The bot reads the chat. It sends a card.\n\n\`\`\`mermaid\n${block}\n\`\`\`\n`;
const writer = { command: ["w"], timeoutSeconds: 900 };
/** Real `.mmd` files in the test's temp folder (removed after each test), and the draft settings naming them. */
function files(texts: Record<string, string>, stackMap = false): DraftSettings {
  const root = tree(texts);
  return { writer, voicePosts: 2, revisions: 2, diagramFiles: Object.keys(texts).map((name) => join(root, name)),
    ...(stackMap ? { stackMap: { command: ["relay"], timeoutSeconds: 60 } } : {}) };
}
const map = async () => MAP;
const sources = (draft: DraftSettings) => readDiagramSources(draft, map);
const check = async (draft: DraftSettings, block: string) => {
  const read = await sources(draft);
  return checkDiagrams(md(block), read.graph, read.unread);
};
const SETUP = "%% the setup\nflowchart LR\n  c[Clock] --> t[Tempo]\n  t --> n[(Notes)]\n";

describe("a Mermaid diagram file", () => {
  it("reads its arrows by label, leaving comments, init lines and frontmatter out", () => {
    const graph = parseDiagramFile(`---\ntitle: x\n---\n%%{init: {}}%%\n${SETUP}`);
    expect(graph.edges).toEqual([{ from: "clock", to: "tempo" }, { from: "tempo", to: "notes" }]);
    expect(graph.nodes.map((n) => n.label)).toEqual(["Clock", "Tempo", "Notes"]);
    expect(parseDiagramFile("graph TD\n  A --> B").edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("refuses a file that is not a flowchart or draws no arrows", () => {
    expect(() => parseDiagramFile("sequenceDiagram\n  A->>B: hi")).toThrow("it is not a Mermaid flowchart");
    expect(() => parseDiagramFile("")).toThrow("it is not a Mermaid flowchart");
    expect(() => parseDiagramFile("flowchart LR\n  a[Clock]\n  b[Tempo]")).toThrow("it draws no arrows");
  });

  it("joins graphs by label, any case", () => {
    const joined = mergeGraphs([{ nodes: [{ id: "x1", label: "Clock" }, { id: "x2", label: "Tempo" }], edges: [{ from: "x1", to: "x2" }] },
      { nodes: [{ id: "clock", label: "clock" }, { id: "notes", label: "Notes" }], edges: [{ from: "clock", to: "notes" }] }]);
    expect(joined).toEqual({ nodes: [{ id: "clock", label: "Clock" }, { id: "tempo", label: "Tempo" }, { id: "notes", label: "Notes" }],
      edges: [{ from: "clock", to: "tempo" }, { from: "clock", to: "notes" }] });
  });
});

describe("diagrams checked against configured files", () => {
  it("passes a file's arrow with no stack map, and fails an arrow neither has", async () => {
    const draft = files({ "setup.mmd": SETUP });
    expect(await check(draft, "flowchart LR\n  a[tempo] --> b[Clock]")).toEqual({ passed: true, findings: [] });
    expect(await check(draft, "flowchart LR\n  a[Clock] --> b[Notes]")).toEqual({ passed: false,
      findings: ["diagram 1 draws Clock → Notes, which the stack map does not have"] });
  });

  it("joins the map and the files: an arrow only the file has passes, one only the map has too", async () => {
    const draft = files({ "setup.mmd": SETUP }, true);
    expect((await check(draft, "flowchart LR\n  a[Tempo] --> b[Notes]\n  c[chatter] --> a")).passed).toBe(true);
    expect((await check(draft, "flowchart LR\n  a[chatter] --> b[Notes]")).passed).toBe(false);
  });

  it("names a missing, non-flowchart or arrowless file, even when the map reads, and draws nothing", async () => {
    const draft = files({ "a.mmd": SETUP, "b.mmd": "pie\n  \"x\": 1", "c.mmd": "flowchart LR\n  a[Clock]" }, true);
    draft.diagramFiles = [join(tempDir(), "gone.mmd"), ...draft.diagramFiles!];
    const read = await sources(draft);
    expect(read).toEqual({ graph: null, unread: ["draft.diagramFiles[0]: the file cannot be read", "draft.diagramFiles[2]: it is not a Mermaid flowchart",
      "draft.diagramFiles[3]: it draws no arrows"], problems: ["draft.diagramFiles[0]: the file cannot be read",
      "draft.diagramFiles[2]: it is not a Mermaid flowchart", "draft.diagramFiles[3]: it draws no arrows"] });
    expect(read.problems.join(" ")).not.toContain("/");
    expect(checkDiagrams(md("flowchart LR\n  a[Idea] --> b[Result]"), read.graph, read.unread).findings)
      .toEqual(["diagram 1 cannot be checked: draft.diagramFiles[0]: the file cannot be read (and 2 more)"]);
    expect(checkDiagrams("No diagrams here.", read.graph, read.unread).passed).toBe(true);
  });

  it("names a stack map that fails beside a file", async () => {
    const read = await readDiagramSources(files({ "a.mmd": SETUP }, true), async () => { throw new Error("relay is not installed"); });
    expect(read).toEqual({ graph: null, problems: ["stack map: relay is not installed"], unread: ["the stack map: relay is not installed"] });
  });

  it("hands the map alone back as it is, and keeps the no-map problem", async () => {
    const mapOnly: DraftSettings = { writer, voicePosts: 2, revisions: 2, stackMap: { command: ["relay"], timeoutSeconds: 60 } };
    const read = await sources(mapOnly);
    expect(read).toEqual({ graph: parseStackMap(MAP), problems: [], unread: [] });
    expect(read.graph?.edges[0]).toEqual({ from: "n1", to: "n2" });
    expect(await sources({ writer, voicePosts: 2, revisions: 2 })).toEqual({ graph: null, problems: ["stack map: no stack map is configured (settings.draft.stackMap)"], unread: [] });
  });

  it("keeps four checks, the diagram one failing on an unread file", () => {
    const report = checkDraft({ title: "Notes", markdown: md("flowchart LR\n  a --> b") }, { terms: [], index: { version: 1, terms: "t", posts: [] }, graph: null,
      diagramProblems: ["draft.diagramFiles[0]: it draws no arrows"] });
    expect(report.checks.map((c) => [c.name, c.passed])).toEqual([["Plain words", true], ["Every stack part linked or explained", true], ["Diagrams match the stack map", false],
      ["Every link leads to a post the blog serves", true]]);
  });
});

describe("settings.draft.diagramFiles", () => {
  const base = { instance: "i", port: 8794, dataDir: "/d" };
  const draft = (diagramFiles: unknown) => parseSettings({ ...base, draft: { writer: { command: ["w"] }, diagramFiles } }).draft;

  it("takes 1 to 10 different absolute paths", () => {
    expect(draft(["/srv/setup.mmd", "/srv/other.mmd"])?.diagramFiles).toEqual(["/srv/setup.mmd", "/srv/other.mmd"]);
  });

  it("names the field, never the path", () => {
    for (const [value, error] of [[[], "settings: draft.diagramFiles must be a list of 1 to 10 absolute paths"], ["/one.mmd", "must be a list of 1 to 10"],
      [Array.from({ length: 11 }, (_, i) => `/f${i}.mmd`), "must be a list of 1 to 10"], [["/a.mmd", "secret/rel.mmd"], "settings: draft.diagramFiles[1] must be an absolute path"],
      [["/a.mmd", "/a.mmd"], "settings: draft.diagramFiles[1] is listed twice"]] as const) {
      expect(() => draft(value)).toThrow(error);
      try { draft(value); } catch (e) { expect(String(e)).not.toMatch(/secret|\/a\.mmd|\/one/u); }
    }
  });
});
