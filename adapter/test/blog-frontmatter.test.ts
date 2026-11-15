import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATE_FIELDS, dateProblems, REQUIRED_DATES } from "../src/publish/frontmatter.js";

const REPO = join(import.meta.dirname, "..", "..");
const head = (...lines: string[]) => ["---", "title: 'T'", ...lines, "---", "Body.", ""].join("\n");

describe("the blog's date fields (ghostpen#108)", () => {
  it("refuses an empty or missing date field, and passes when lastmod is left out", () => {
    expect(dateProblems(head("date: '2026-01-01'", "lastmod: ''"))).toEqual(["lastmod is empty: give a date or leave the line out"]);
    expect(dateProblems(head("date: '2026-01-01'", "lastmod:"))).toEqual(["lastmod is empty: give a date or leave the line out"]);
    expect(dateProblems(head("tags: []"))).toEqual(["date is missing"]);
    expect(dateProblems(head("date: ''"))).toEqual(["date is empty: give a date"]);
    expect(dateProblems(head("date: 2021-08-07T15:32:14Z", "lastmod: 'soon'"))).toEqual(["lastmod is not a date: give it as YYYY-MM-DD"]);
    expect(dateProblems(head("date: '2026-13-45'"))).toEqual(["date is not a date: give it as YYYY-MM-DD"]);
    expect(dateProblems(head("date: '2026-01-01'"))).toEqual([]);
    expect(dateProblems(head("date: 2026-03-24", "lastmod: '2026-03-25'"))).toEqual([]);
  });

  it.each(["data/blog", "content-sample/blog"])("holds every post in %s to it", (from) => {
    const dir = join(REPO, from);
    const posts = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".mdx"));
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.flatMap((name) => dateProblems(readFileSync(join(dir, name), "utf8")).map((problem) => `${name}: ${problem}`))).toEqual([]);
  });

  it("knows every date field of the blog's Blog type, and which are required", () => {
    const config = readFileSync(join(REPO, "contentlayer.config.ts"), "utf8");
    const fields = /name: 'Blog'[\s\S]*?\n {2}fields: \{([\s\S]*?)\n {2}\},/u.exec(config)?.[1] ?? "";
    const dates = [...fields.matchAll(/^\s*(\w+): \{ type: 'date'([^}]*)\}/gmu)];
    expect(dates.map((m) => m[1])).toEqual([...DATE_FIELDS]);
    expect(dates.filter((m) => m[2]!.includes("required: true")).map((m) => m[1])).toEqual([...REQUIRED_DATES]);
  });
});
