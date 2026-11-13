/** `node dist/cli/rank.js <settings.json>`: one ranking run now, by hand. The service also ranks on its own when the weekly shortlist asks (docs/ranking.md); both take ranking.lock, so one runs at a time. */
import { attemptRanking, HELD } from "../ranking/attempt.js";
import { readSettings } from "../settings.js";

const path = process.argv[2];
if (!path) { console.error("usage: node dist/cli/rank.js <settings.json>"); process.exit(2); }
attemptRanking(readSettings(path), "hand").then(({ attempt, view }) => {
  if (!view) { console.error(`ghostpen rank: ${attempt.outcome === "skipped" ? HELD : attempt.problem ?? "the ranking failed"}`); process.exit(1); }
  console.log(`ranked ${view.entries.length} candidates; ${view.background.length} background posts; ${view.owed.length} post-mortems booked`);
  for (const problem of view.problems) console.log(`problem: ${problem}`);
}, (error: unknown) => { console.error(`ghostpen rank: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
