import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Root is the repository, not adapter/: the JUnit report then names each test file by its repository path
// (adapter/test/x.test.ts), which the check runner needs to time files and to require the report (ADR 0028).
export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({ test: { root: REPO_ROOT, include: ["adapter/test/**/*.test.ts"], pool: "forks" } });
