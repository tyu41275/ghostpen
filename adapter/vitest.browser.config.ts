import { defineConfig } from "vitest/config";
import { REPO_ROOT } from "./vitest.config";

// ghostpen's real-browser suite (ADR 0101, pattern adapter-app): the app page in Chromium through Playwright, apart from `npm test`.
// Root is the repository (see vitest.config.ts), so the JUnit report names files as adapter/e2e/… for the check runner.
export default defineConfig({ test: { root: REPO_ROOT, include: ["adapter/e2e/**/*.browser.test.ts"], pool: "forks", testTimeout: 30_000, hookTimeout: 60_000 } });
