/** `node dist/service/main.js <settings.json>`: answers health and the app on loopback (docs/adapter.md). */
import { startService } from "./start.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node dist/service/main.js <settings.json>");
  process.exit(2);
}
startService(path).then(({ server, port }) => {
  console.log(`ghostpen: health on 127.0.0.1:${port}`);
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}, (error: unknown) => {
  console.error(`ghostpen: not started: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
