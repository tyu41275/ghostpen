/**
 * ghostpen's app page in real Chromium, as the operator reaches it through chatter's console: the real server, a signed
 * viewer. Asserts what the page says (who is signed in, what ghostpen does, that nothing is ranked yet, values escaped)
 * and that a viewer the console did not sign gets nothing.
 */
import type { AddressInfo } from "node:net";
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

async function app(): Promise<string> {
  const server = createGhostpenServer({ instance: "personal-comms-host", dataDir: tempDir(), appKey: KEY, now: () => NOW });
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
});
