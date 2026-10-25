/**
 * The real screenshot capture in Chromium: masked text is left out of the privacy check, hidden text is ignored,
 * field values and unreadable content (a canvas) are seen, and the picture is a PNG.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { playwrightCapture, privacyFindings, type ShotPage } from "../src/draft/screenshots.js";

const PAGES: Record<string, string> = {
  "/masked": "<main><h1>Tasks</h1><p class=who>Signed in as tim@example.com</p><p style='display:none'>secret@example.com</p></main>",
  "/open": "<main><h1>Tasks</h1><input value='tim@example.com'></main>",
  "/canvas": "<main><h1>Chart</h1><canvas width=100 height=100></canvas></main>",
};
let server: Server;
let origin = "";
beforeAll(async () => {
  server = createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(`<!doctype html><body>${PAGES[req.url ?? ""] ?? "gone"}</body>`); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const page = (path: string, mask: string[] = []): ShotPage => ({ name: "p", url: `${origin}${path}`, description: "d", mask, width: 640, height: 480 });

describe("screenshot capture", () => {
  it("leaves masked and hidden text out and gives a PNG", async () => {
    const shot = await playwrightCapture(page("/masked", [".who"]), 15_000);
    expect(shot.text).toEqual(["Tasks"]);
    expect(shot.unreadable).toEqual([]);
    expect(shot.png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("sees unmasked text and field values", async () => {
    expect(privacyFindings((await playwrightCapture(page("/masked"), 15_000)).text, [])).toEqual(["an email address"]);
    expect(privacyFindings((await playwrightCapture(page("/open"), 15_000)).text, [])).toEqual(["an email address"]);
  });

  it("reports a canvas it cannot read, unless masked", async () => {
    expect((await playwrightCapture(page("/canvas"), 15_000)).unreadable).toEqual(["canvas"]);
    expect((await playwrightCapture(page("/canvas", ["canvas"]), 15_000)).unreadable).toEqual([]);
  });

  it("fails on a page that does not load", async () => {
    await expect(playwrightCapture({ ...page("/"), url: "http://127.0.0.1:1/" }, 5_000)).rejects.toThrow();
  });
});
