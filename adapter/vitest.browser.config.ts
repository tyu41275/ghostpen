import { defineConfig } from "vitest/config";

// ghostpen's real-browser suite (ADR 0101, pattern adapter-app): the app page in Chromium through Playwright, apart from `npm test`.
export default defineConfig({ test: { include: ["e2e/**/*.browser.test.ts"], pool: "forks", testTimeout: 30_000, hookTimeout: 60_000 } });
