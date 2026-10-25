/** `node dist/cli/draft.js <settings.json> <id>`: draft one post now (a candidate id, or `background:<part>`); prints its report. */
import { reportText } from "../draft/checks.js";
import { draftFile, draftNow } from "../draft/write.js";
import { readSettings } from "../settings.js";

const [path, id] = process.argv.slice(2);
if (!path || !id) { console.error("usage: node dist/cli/draft.js <settings.json> <id>"); process.exit(2); }
const settings = readSettings(path);
draftNow(settings, id).then((draft) => {
  console.log(`${draft.status}: "${draft.title}" after ${draft.attempts} attempt(s), kept in ${draftFile(settings.dataDir, id)}`);
  console.log(reportText(draft.report));
  for (const problem of draft.problems) console.log(`problem: ${problem}`);
}, (error: unknown) => { console.error(`ghostpen draft: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
