/**
 * ghostpen#146: each model turn sends its instructions version, kept with what the turn ran on, so an outcome can be
 * joined to the instructions that made it. A change to the fixed words of an instruction must come with a new version:
 * these pin each one's sha256, with fixed arguments, under its version.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { editPrompt, revisePrompt, WRITER_VERSION, writerPrompt, type WriterBrief } from "../src/draft/prompt.js";
import { THREAD_INSTRUCTIONS, THREAD_VERSION } from "../src/feedback/thread.js";
import { candidateOf } from "../src/ranking/candidates.js";
import { SCORER_VERSION, scorerPrompt } from "../src/ranking/scorer.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const bump = (name: string, file: string) =>
  `these instructions changed: bump ${name} in ${file}, then pin the new version and hashes here (never change a pin under its old version)`;

const BRIEF: WriterBrief = { kind: "decision", subject: "Subject", topic: "Topic", takeaway: "Takeaway",
  documents: [{ id: "d", kind: "decision", source: "s", title: "Document", lines: ["Line one."], location: { path: "/d.md", line: 1 } }],
  parts: [{ term: "Alpha", post: { url: "/blog/alpha", title: "Alpha" } }, { term: "Beta", definition: "A beta part." }],
  graph: { nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }], edges: [{ from: "a", to: "b" }] },
  styleGuide: "Guide.", voice: [{ title: "Voice", body: "Body." }], context: ["Context."], screenshots: [{ name: "page", description: "A page." }] };
const PREVIOUS = { title: "Title", summary: "Summary.", tags: ["tag"], markdown: "Markdown." };
const scored = (kind: "decision" | "experiment") =>
  candidateOf({ id: kind, kind, source: "s", title: "Document", lines: ["# Document", "Line one."], location: { path: "/d.md", line: 1 } });
const REPORT = { passed: false, grade: 3, hold: [], later: [], checks: [{ name: "Check", passed: false, findings: ["Finding."] }] };

describe("instructions versions", () => {
  it("pins the writer's prompts under WRITER_VERSION", () => {
    expect({ version: WRITER_VERSION, writerPrompt: sha(writerPrompt(BRIEF)), revisePrompt: sha(revisePrompt(BRIEF, PREVIOUS, REPORT)),
      editPrompt: sha(editPrompt(BRIEF, PREVIOUS, "Notes.")) }, bump("WRITER_VERSION", "src/draft/prompt.ts")).toEqual({ version: "1",
      writerPrompt: "b1b364710f35332cb8802cf77a455db4337b84ab8167a5017dba78ac26d77e82",
      revisePrompt: "22e35a389ce66367caa700d0a8daa4f1a63ad2e02e6d4cc011b7086c530b5332",
      editPrompt: "0c36055aef59b89a103e245c0d394cd13c50eb3e81e37946b44104e3aee933c0" });
  });

  it("pins the thread answerer's fixed instructions under THREAD_VERSION", () => {
    expect({ version: THREAD_VERSION, instructions: sha(THREAD_INSTRUCTIONS.join("\n")) }, bump("THREAD_VERSION", "src/feedback/thread.ts"))
      .toEqual({ version: "1", instructions: "2f781d7ac0f962afcffeccd8649e7b26c13467b966af736d718499d7f738d357" });
  });

  it("pins the scorer's prompts under SCORER_VERSION, for a decision post and a post-mortem", () => {
    expect({ version: SCORER_VERSION, decision: sha(scorerPrompt(scored("decision"))), postMortem: sha(scorerPrompt(scored("experiment"))) },
      bump("SCORER_VERSION", "src/ranking/scorer.ts")).toEqual({ version: "1",
      decision: "48b2d781bc752ee2c60923e5f2d50642321e078b8c5e5367f5234a415f8a3a48",
      postMortem: "185b6b0cd113a29da16c02f4337d3fe7e60f40ebe32d122aeecf2cf9a645f5e3" });
  });
});
