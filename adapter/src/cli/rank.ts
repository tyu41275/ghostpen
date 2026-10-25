/** `node dist/cli/rank.js <settings.json>`: one ranking run now (the weekly shortlist runs the same, ghostpen#89). */
import { rankNow } from "../ranking/run.js";
import { readSettings } from "../settings.js";

const path = process.argv[2];
if (!path) { console.error("usage: node dist/cli/rank.js <settings.json>"); process.exit(2); }
rankNow(readSettings(path)).then((view) => {
  console.log(`ranked ${view.entries.length} candidates; ${view.background.length} background posts; ${view.owed.length} post-mortems booked`);
  for (const problem of view.problems) console.log(`problem: ${problem}`);
}, (error: unknown) => { console.error(`ghostpen rank: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
