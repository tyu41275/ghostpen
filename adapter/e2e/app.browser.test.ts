/**
 * ghostpen's app page in real Chromium, as the operator reaches it through chatter's console: the real server, a signed
 * viewer. Asserts what the page says (who is signed in, what ghostpen does, that nothing is ranked yet, values escaped)
 * and that a viewer the console did not sign gets nothing.
 */
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGhostpenServer } from "../src/service/server.js";
import { identity, KEY, tempDir } from "../test/helpers.js";

const NOW = Date.parse("2026-10-24T22:00:00Z");
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

async function app(ranking?: unknown, feedback?: unknown[]): Promise<string> {
  const dataDir = tempDir();
  if (ranking !== undefined) writeFileSync(join(dataDir, "ranking.json"), typeof ranking === "string" ? ranking : JSON.stringify(ranking));
  if (feedback !== undefined) writeFileSync(join(dataDir, "feedback.json"), JSON.stringify({ version: 1, entries: feedback }));
  const server = createGhostpenServer({ instance: "personal-comms-host", dataDir, appKey: KEY, now: () => NOW });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/app/`;
}

const signed = (login: string) => ({ "x-chatter-identity": identity({ aud: "ghostpen", login, sub: "42", iat: NOW / 1000 - 5, exp: NOW / 1000 + 600 }) });

describe("ghostpen app page", () => {
  it("shows a signed viewer what ghostpen does and that nothing is ranked yet, with their name escaped", async () => {
    const page = await (await browser.newContext({ extraHTTPHeaders: signed("<b>tim</b>") })).newPage();
    const response = await page.goto(await app());
    expect(response?.status()).toBe(200);
    expect(await page.locator("h1").innerText()).toBe("ghostpen — personal-comms-host");
    expect(await page.locator("header p").innerText()).toContain("Signed in as <b>tim</b>");
    expect(await page.locator("header b").count()).toBe(0); // the login is text, never markup
    expect(await page.locator("[data-section=about] h2").innerText()).toBe("What ghostpen does");
    expect(await page.locator("[data-section=about] p").innerText()).toContain("Nothing is published until you press Publish.");
    expect(await page.locator("[data-empty=ranking]").innerText()).toBe("Nothing is ranked yet. The ranking appears here once ghostpen reads its sources.");
  });

  it("shows nothing to a viewer the console did not sign", async () => {
    const page = await (await browser.newContext()).newPage();
    const response = await page.goto(await app());
    expect(response?.status()).toBe(404);
    expect(await page.locator("h1").count()).toBe(0);
  });

  it("shows the last ranking: each topic with its scores and the line behind each, posts to write first, post-mortems owed and problems", async () => {
    const ranking = { ranAt: "2026-10-25T00:00:00.000Z", entries: [
      { id: "d:0028", kind: "decision", title: "ADR 0028", topic: "Why <slow> tests moved", takeaway: "Split tests by speed", total: 5,
        explain: ["ci", "check runner"], location: "/o/0028.md:1", scores: [
          { factor: "stakes", score: 3, quote: "CI is the main delivery bottleneck", line: 2, location: "/o/0028.md:2" },
          { factor: "thoughtProcess", score: 0, quote: "", line: null, note: "its quote is not in the source", location: "/o/0028.md" }] },
      { id: "e:trial", kind: "post-mortem", title: "Trial", topic: "A trial that failed", takeaway: "", total: 2, explain: [], location: "/o/t.md:1",
        scores: [{ factor: "evidence", score: 2, quote: "fell 28% against the baseline", line: 3, location: "/o/t.md:3" }] }],
      background: [{ part: "ci", unlocks: ["d:0028", "x"] }],
      owed: [{ decision: "d:0022", title: "ADR 0022", bookedAt: "2026-10-01T00:00:00Z", due: true, evidence: ["gh:o/r#9"] }],
      problems: ["github: o/r cannot be read (GitHub answered 404)"] };
    const page = await (await browser.newContext({ extraHTTPHeaders: signed("tim") })).newPage();
    await page.goto(await app(ranking));
    const rows = page.locator("[data-section=ranking] tbody tr");
    expect(await rows.count()).toBe(2);
    expect(await rows.nth(0).locator("strong").innerText()).toBe("Why <slow> tests moved"); // text, never markup
    expect(await rows.nth(0).locator("[data-field=total]").innerText()).toBe("5");
    expect(await rows.nth(0).locator("td").nth(2).innerText()).toBe("Decision post");
    expect(await rows.nth(1).locator("td").nth(2).innerText()).toBe("Post-mortem");
    const stakes = rows.nth(0).locator("details").nth(0);
    expect(await stakes.locator("summary").innerText()).toBe("Stakes: 3");
    await stakes.locator("summary").click();
    expect(await stakes.locator("blockquote").innerText()).toBe("CI is the main delivery bottleneck");
    expect(await stakes.innerText()).toContain("/o/0028.md:2");
    const thinking = rows.nth(0).locator("details").nth(1);
    await thinking.locator("summary").click();
    expect(await thinking.innerText()).toContain("its quote is not in the source");
    expect(await rows.nth(0).locator("td").nth(5).innerText()).toBe("ci, check runner");
    expect(await page.locator("[data-section=background] li").innerText()).toBe("ci: unlocks 2 topics");
    expect(await page.locator("[data-section=owed] li").innerText()).toBe("ADR 0022: due now (gh:o/r#9)");
    expect(await page.locator("[data-section=problems] li").innerText()).toBe("github: o/r cannot be read (GitHub answered 404)");
  });

  it("shows what the operator told ghostpen: context under its topic, every note newest first, as text", async () => {
    const ranking = { ranAt: "2026-10-25T00:00:00.000Z", problems: [], background: [], owed: [], entries: [
      { id: "d:1", kind: "decision", title: "ADR 1", topic: "One timer app", takeaway: "Fewer timers", total: 6, explain: [], location: "/o/1.md:1", scores: [] }] };
    const note = (kind: string, text: string, action?: string) => ({ at: "2026-10-26T14:00:00Z", by: "234652039735541760", topic: "d:1", kind, text, intake: "pending", ...(action ? { action } : {}) });
    const page = await (await browser.newContext({ extraHTTPHeaders: signed("tim") })).newPage();
    await page.goto(await app(ranking, [note("reason", "Others would find it useful", "write"), note("context", "We tried <b>three</b> timers first"),
      note("question", "Why first?"), note("answer", "It saved two hours a week.")]));
    expect(await page.locator("[data-candidate='d:1'] [data-field=context] li").allInnerTexts()).toEqual(["Your context: We tried <b>three</b> timers first"]);
    expect(await page.locator("[data-section=notes] li").evaluateAll((items) => items.map((li) => li.getAttribute("data-kind"))))
      .toEqual(["answer", "question", "context", "reason"]);
    expect(await page.locator("[data-section=notes] li").first().innerText()).toBe("ghostpen answered, d:1: It saved two hours a week.");
    expect(await page.locator("[data-section=notes] b").count()).toBe(0); // text, never markup
  });

  it("says when the last ranking cannot be read or is not a ranking, never showing an empty one or failing", async () => {
    const base = { ranAt: "x", entries: [], background: [], owed: [], problems: [] };
    const goodEntry = { id: "a", kind: "decision", title: "t", topic: "t", takeaway: "", total: 1, explain: [], location: "l", scores: [] };
    for (const content of ["{ broken", "{}", "[]", JSON.stringify({ ...base, entries: {} }), JSON.stringify({ ...base, entries: [null] }),
      JSON.stringify({ ...base, entries: [{ ...goodEntry, scores: [{ factor: "stakes" }] }] }), JSON.stringify({ ...base, entries: [{ ...goodEntry, explain: "x" }] }),
      JSON.stringify({ ...base, background: [{ part: "ci" }] }), JSON.stringify({ ...base, owed: [{ decision: "d" }] }), JSON.stringify({ ...base, problems: [1] })]) {
      const page = await (await browser.newContext({ extraHTTPHeaders: signed("tim") })).newPage();
      const response = await page.goto(await app(content));
      expect(response?.status()).toBe(200);
      expect(await page.locator("[data-error=ranking]").innerText()).toMatch(/^The last ranking cannot be read: /u);
      expect(await page.locator("[data-empty=ranking]").count()).toBe(0);
    }
  });
});
