import { describe, expect, it } from "vitest";
import { checkDraft, reportText } from "../src/draft/checks.js";
import { checkDiagrams, mermaidBlocks, parseFlowchart, type StackGraph } from "../src/draft/diagrams.js";
import { checkPlain, prose, sentencesOf, syllables } from "../src/draft/plain.js";
import { checkStackParts } from "../src/draft/stack-parts.js";
import type { PublishedIndex, PublishedPost } from "../src/sources/published.js";

const post = (over: Partial<PublishedPost>): PublishedPost => ({
  file: "a.mdx", hash: "h", url: "https://blog.example/blog/a", title: "A", date: "2026-01-01", tags: [], draft: false,
  about: [], mentions: [], ...over,
});
const index = (...posts: PublishedPost[]): PublishedIndex => ({ version: 1, terms: "t", posts });
const EMPTY = index();
const GRAPH: StackGraph = {
  nodes: [{ id: "chatter", label: "chatter" }, { id: "clock", label: "Clock" }, { id: "tempo", label: "Tempo" }],
  edges: [{ from: "chatter", to: "clock" }, { from: "chatter", to: "tempo" }],
};
const SIMPLE = "The bot reads the chat. It sends a card. You press a button. The card goes away.";

describe("plain words", () => {
  it("counts syllables roughly", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("table")).toBe(2);
    expect(syllables("computer")).toBe(3);
    expect(syllables("made")).toBe(1);
    expect(syllables("123")).toBe(0);
  });

  it("leaves code, diagrams, link addresses, headings and frontmatter out of the prose", () => {
    const text = prose("---\ntitle: X\n---\n# Heading words\nSee [the post](https://a.example/long/path).\n```ts\nconst veryLongIdentifier = 1;\n```\nRun `npm install` now.\n| a | b |\n");
    expect(text).toContain("See the post.");
    expect(text).toContain("Run  code  now.");
    expect(text).not.toMatch(/Heading|title|https|veryLong|\| a/u);
  });

  it("leaves bare web addresses out of the grade", () => {
    expect(prose("See https://example.com/a/very-long-address-with-many-syllables-in-it.html now.")).toBe("See  link  now.");
    expect(checkPlain(`${SIMPLE} Read it at https://example.com/organisational-infrastructure-modernisation.`).passed).toBe(true);
  });

  it("splits sentences at stops and blank lines", () => {
    expect(sentencesOf("One two. Three four! Five?\n\nsix seven")).toEqual(["One two.", "Three four!", "Five?", "six seven"]);
  });

  it("passes short plain prose", () => {
    const result = checkPlain(SIMPLE);
    expect(result.passed).toBe(true);
    expect(result.grade).toBeLessThanOrEqual(8);
    expect(result.findings).toEqual([]);
  });

  it("fails dense prose and names the grade", () => {
    const dense = "Organisational infrastructure modernisation necessitates comprehensive architectural reconsideration. Sophisticated orchestration methodologies facilitate unprecedented operational extensibility.";
    const result = checkPlain(dense);
    expect(result.passed).toBe(false);
    expect(result.grade).toBeGreaterThan(8);
    expect(result.findings[0]).toMatch(/^reading grade [\d.]+ is above 8/u);
  });

  it("names sentences over the word limit, longest first, at most three", () => {
    const sentence = (n: number) => `Cat ${Array.from({ length: n - 1 }, () => "cat").join(" ")}.`;
    const text = [sentence(31), sentence(40), sentence(35), sentence(32), sentence(30)].join(" ");
    const result = checkPlain(text, { maxGrade: 99, maxSentenceWords: 30 });
    expect(result.passed).toBe(false);
    expect(result.findings.map((f) => f.slice(0, 14))).toEqual(["a 40-word sent", "a 35-word sent", "a 32-word sent", "1 more sentenc"]);
  });

  it("fails a draft with no prose", () => {
    expect(checkPlain("```js\nx\n```").findings).toEqual(["the draft has no prose to read"]);
  });
});

describe("every stack part linked or explained", () => {
  it("passes a part that has a post when the draft links it, by address or by path", () => {
    const idx = index(post({ about: ["tempo"] }));
    expect(checkStackParts("Weekly notes", "We use [Tempo](https://blog.example/blog/a) for this.", ["Tempo"], idx).passed).toBe(true);
    expect(checkStackParts("Weekly notes", "We use [Tempo](/blog/a) for this.", ["Tempo"], idx).passed).toBe(true);
  });

  it("counts only real links outside code, ignoring a trailing slash or #part", () => {
    const idx = index(post({ about: ["tempo"] }));
    const check = (text: string) => checkStackParts("Notes", text, ["Tempo"], idx).passed;
    expect(check("Tempo grades work.\n```\n[post](https://blog.example/blog/a)\n```")).toBe(false);
    expect(check("Tempo grades work. See `[post](https://blog.example/blog/a)`.")).toBe(false);
    expect(check("Tempo grades work: https://blog.example/blog/a")).toBe(false);
    expect(check("Tempo grades work. [More](https://blog.example/blog/a/#start).")).toBe(true);
    expect(check("Tempo grades work. <https://blog.example/blog/a>")).toBe(true);
    expect(check('[Tempo](/blog/a "the post") grades work.')).toBe(true);
    expect(check("[Tempo](/blog/ab) grades work.")).toBe(false);
  });

  it("fails a part that has a post when the draft does not link it, even if explained", () => {
    const result = checkStackParts("Weekly notes", "We use Tempo, a tool that grades work.", ["Tempo"], index(post({ about: ["tempo"] })));
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual(["Tempo has a post: link https://blog.example/blog/a where it first appears"]);
    expect(result.later).toEqual([]);
  });

  it("links the newest published post, not a draft", () => {
    const idx = index(post({ about: ["tempo"], url: "https://blog.example/blog/old", date: "2026-01-01" }),
      post({ about: ["tempo"], url: "https://blog.example/blog/new", date: "2026-03-01" }),
      post({ about: ["tempo"], url: "https://blog.example/blog/draft", date: "2026-05-01", draft: true }));
    expect(checkStackParts("Notes", "Tempo grades work.", ["Tempo"], idx).findings[0]).toContain("/blog/new");
  });

  it("holds the draft for a part in the title with no post", () => {
    const result = checkStackParts("How Clock works", "Clock is a timer.", ["Clock"], EMPTY);
    expect(result).toMatchObject({ passed: false, hold: ["Clock"], later: [] });
    expect(result.findings[0]).toMatch(/^Clock is central to this draft and has no post yet/u);
  });

  it("holds the draft for a part named three times, not twice", () => {
    expect(checkStackParts("Notes", "Clock is a timer. Clock runs. Clock stops.", ["Clock"], EMPTY).hold).toEqual(["Clock"]);
    expect(checkStackParts("Notes", "Clock is a timer. Clock runs.", ["Clock"], EMPTY).hold).toEqual([]);
  });

  it("puts a passing part that is explained on the posts-to-write-later list", () => {
    for (const text of ["We use Clock, a small timer app.", "We use Clock (a timer).", "Clock is the timer.", "We added Clock: a timer."]) {
      expect(checkStackParts("Notes", text, ["Clock"], EMPTY)).toMatchObject({ passed: true, later: ["Clock"] });
    }
  });

  it("fails a passing part that is not explained", () => {
    const result = checkStackParts("Notes", "Then we turned on Clock and waited for many long days.", ["Clock"], EMPTY);
    expect(result).toMatchObject({ passed: false, later: [], hold: [] });
    expect(result.findings).toEqual(["Clock has no post: explain it in a few plain words where it first appears"]);
  });

  it("only looks for the explanation near the first mention", () => {
    const far = "We turned on Clock and then we waited for one two three four five six seven eight nine days, a long time.";
    expect(checkStackParts("Notes", far, ["Clock"], EMPTY).passed).toBe(false);
  });

  it("matches whole words only and ignores terms the draft never names", () => {
    const result = checkStackParts("Notes", "The clockwork turns.", ["Clock", "Tempo", "x"], EMPTY);
    expect(result).toMatchObject({ passed: true, findings: [], hold: [], later: [] });
  });

  it("does not count names inside code or link addresses", () => {
    const text = "We ran it. `Clock` printed. See [this](https://a.example/Clock).\n```\nClock Clock Clock\n```";
    expect(checkStackParts("Notes", text, ["Clock"], EMPTY).passed).toBe(true);
  });
});

describe("diagrams match the stack map", () => {
  const md = (body: string) => `Intro.\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`;

  it("finds Mermaid blocks and reads boxes and arrows", () => {
    expect(mermaidBlocks(md("flowchart LR\n  a --> b"))).toHaveLength(1);
    const { labels, arrows } = parseFlowchart('flowchart LR\n  a["chatter"] --> b[[Clock]]\n  b -. "off" .-> c(Tempo)\n  c ==> d{Relay}\n  d -->|uses| a');
    expect([...labels]).toEqual([["a", "chatter"], ["b", "Clock"], ["c", "Tempo"], ["d", "Relay"]]);
    expect(arrows).toEqual([["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]]);
  });

  it("reads every Mermaid link kind, chains, & groups and worded links, but not invisible ones", () => {
    const arrows = (body: string) => parseFlowchart(body).arrows;
    expect(arrows("a --o b\nc --x d\ne <--> f\ng o--o h\ni x--x j")).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"], ["i", "j"]]);
    expect(arrows("a ---> b\nc -..-> d\ne ====> f\ng --- h\ni -.- j\nk === l")).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"], ["i", "j"], ["k", "l"]]);
    expect(arrows("a -- talks to --> b\nc == calls ==> d\ne -. maybe .-> f")).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
    expect(arrows("a --> b --> c\nd & e --> f")).toEqual([["a", "b"], ["b", "c"], ["d", "f"], ["e", "f"]]);
    expect(arrows("Tempo-->Clock\nbox --> echo")).toEqual([["Tempo", "Clock"], ["box", "echo"]]);
    expect(arrows("a ~~~ b\nclassDef x fill:#f00\nstyle a fill:#0f0\n%% a --> b")).toEqual([]);
    const { labels } = parseFlowchart('a{{"chatter"}} --> b>Clock] --> c(((Tempo)))\nd[("Relay")] --> e[/Disk/]');
    expect([...labels]).toEqual([["a", "chatter"], ["b", "Clock"], ["c", "Tempo"], ["d", "Relay"], ["e", "Disk"]]);
  });

  it("fails a circle or cross link the map does not have", () => {
    expect(checkDiagrams(md("flowchart LR\n  a[Clock] --o b[Tempo]"), GRAPH).passed).toBe(false);
    expect(checkDiagrams(md("flowchart LR\n  Clock --x Tempo"), GRAPH).passed).toBe(false);
  });

  it("passes arrows the map has, in either direction", () => {
    expect(checkDiagrams(md("flowchart LR\n  a[chatter] --> b[Clock]\n  c[tempo] --> a"), GRAPH).passed).toBe(true);
  });

  it("fails an arrow the map does not have", () => {
    const result = checkDiagrams(md("flowchart LR\n  a[chatter] --> b[Clock]\n  b --> c[Tempo]"), GRAPH);
    expect(result).toEqual({ passed: false, findings: ["diagram 1 draws Clock → Tempo, which the stack map does not have"] });
  });

  it("leaves concept diagrams alone", () => {
    expect(checkDiagrams(md("flowchart LR\n  a[Idea] --> b[Clock]\n  b --> c[Result]"), GRAPH).passed).toBe(true);
  });

  it("ignores arrows to boxes the map does not know inside a stack diagram", () => {
    expect(checkDiagrams(md("flowchart LR\n  a[chatter] --> b[Clock]\n  b --> c[You]"), GRAPH).passed).toBe(true);
  });

  it("says a diagram cannot be checked when no map is configured", () => {
    expect(checkDiagrams(md("flowchart LR\n  a[chatter] --> b[Clock]"), null).findings).toEqual(["diagram 1 cannot be checked: no stack map is configured"]);
    expect(checkDiagrams("No diagrams here.", null).passed).toBe(true);
    expect(checkDiagrams(md("flowchart LR\n  chatter --> Clock"), null).passed).toBe(false);
    expect(checkDiagrams(md('pie\n  "yes": 3\n  "no": 1'), null).passed).toBe(true);
  });
});

describe("the whole report", () => {
  it("passes a clean draft and lists later posts", () => {
    const report = checkDraft({ title: "Notes", markdown: `${SIMPLE} We use Clock, a timer.` }, { terms: ["Clock"], index: EMPTY, graph: GRAPH });
    expect(report.passed).toBe(true);
    expect(report.later).toEqual(["Clock"]);
    expect(reportText(report)).toBe([
      "All checks passed.", `Reading grade: ${report.grade}.`, "✅ Plain words", "✅ Every stack part linked or explained",
      "✅ Diagrams match the stack map", "Posts to write later: Clock.",
    ].join("\n"));
  });

  it("fails when any one check fails and says why", () => {
    const report = checkDraft({ title: "How Clock works", markdown: SIMPLE }, { terms: ["Clock"], index: EMPTY, graph: null });
    expect(report.passed).toBe(false);
    expect(report.checks.map((c) => c.passed)).toEqual([true, false, true]);
    const text = reportText(report);
    expect(text.split("\n")[0]).toBe("Some checks failed; the draft is not ready.");
    expect(text).toContain("❌ Every stack part linked or explained\n   - Clock is central");
    expect(text).toContain("Waiting for background posts first: Clock.");
  });

  it("uses the plain-word limits given", () => {
    const report = checkDraft({ title: "Notes", markdown: SIMPLE }, { terms: [], index: EMPTY, graph: null, plain: { maxGrade: -20, maxSentenceWords: 30 } });
    expect(report.checks[0]!.passed).toBe(false);
  });
});
