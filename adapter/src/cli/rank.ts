/**
 * `node dist/cli/rank.js`: rankings no longer run here. The scorer is a model turn chatter runs for ghostpen's service
 * (ghostpen#146), and a command-line process has no chatter, so the service ranks: on its own before each weekly shortlist,
 * and again after a failed try (`ranking/jobs.ts`). This says so and exits 1.
 */
import { RETRY_MS } from "../ranking/jobs.js";

console.error("ghostpen rank: rankings run in ghostpen's service, which asks chatter to run the scorer, so this command "
  + `cannot rank. The service ranks on its own before each weekly shortlist, and tries a failed ranking again ${RETRY_MS / 60_000} `
  + "minutes after it failed at the soonest; its app page shows the last ranking and the last try.");
process.exit(1);
