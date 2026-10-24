// Fails when a tracked file under adapter/ is over its line limit: 500, or 300 for AGENTS.md/CLAUDE.md. Lock files are exempt.
// Only the adapter's own files: the blog in the repo root is not under this rule's check.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const files = execFileSync("git", ["ls-files", "."], { encoding: "utf8" }).split("\n").filter(Boolean);
const over = [];
for (const file of files) {
  if (basename(file) === "package-lock.json") continue;
  const limit = ["AGENTS.md", "CLAUDE.md"].includes(basename(file)) ? 300 : 500;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n").length - (text === "" || text.endsWith("\n") ? 1 : 0); // a last line without "\n" counts
  if (lines > limit) over.push(`${file}: ${lines} lines (limit ${limit})`);
}
if (over.length) {
  console.error(`Files over their size limit:\n${over.join("\n")}\nSplit them.`);
  process.exit(1);
}
console.log(`file sizes OK (${files.length} files)`);
