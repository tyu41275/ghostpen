#!/usr/bin/env bash
# The adapter-smoke check (ghostpen ADR 0101): chatter's own `chatter smoke`, from the ensemble-chatter checkout
# the check runner provides ($CHECK_WITH), runs adapter/smoke/cases.json through chatter's real adapter loader and
# command handlers against a real ghostpen service started here, with a fresh data folder in $RUNNER_TEMP. Run from the repository root; the adapter lives in adapter/
set -euo pipefail
: "${RUNNER_TEMP:?}" "${CHECK_WITH:?}"
repo=$PWD
cd adapter
# The newest Node 24, as the `test` check uses.
node_ver=$(curl -fsSL --retry 3 https://nodejs.org/dist/index.json | python3 -c 'import json,sys; print(next(r["version"] for r in json.load(sys.stdin) if r["version"].startswith("v24.")))')
mkdir -p "$RUNNER_TEMP/node24"
curl -fsSL --retry 3 "https://nodejs.org/dist/$node_ver/node-$node_ver-linux-x64.tar.xz" | tar -xJ -C "$RUNNER_TEMP/node24" --strip-components=1
export PATH="$RUNNER_TEMP/node24/bin:$PATH"
node --version
bash scripts/ci-npm-ci.sh
npm run build

dir="$RUNNER_TEMP/ghostpen-smoke"
mkdir -p "$dir"
# A free loopback port, the service's settings and the adapter's config naming them.
node --input-type=module - "$dir" <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
const dir = process.argv[2];
const port = await new Promise((resolve) => { const probe = createServer().listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
mkdirSync(`${dir}/data`, { recursive: true });
writeFileSync(`${dir}/settings.json`, JSON.stringify({ instance: "ci-ghostpen", port, dataDir: `${dir}/data` }));
writeFileSync(`${dir}/adapter.json`, JSON.stringify({ settingsFile: `${dir}/settings.json` }));
NODE
node dist/service/main.js "$dir/settings.json" > "$dir/service.log" 2>&1 &
service=$!
trap 'kill "$service" 2>/dev/null || true; wait "$service" 2>/dev/null || true; echo "::group::ghostpen service log"; cat "$dir/service.log"' EXIT
port=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).port' "$dir/settings.json")
for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$port/health" > /dev/null 2>&1 && break
  kill -0 "$service" 2>/dev/null || { echo "the ghostpen service exited before it answered"; exit 1; }
  sleep 0.2
done
curl -fsS "http://127.0.0.1:$port/health" > /dev/null || { echo "the ghostpen service did not answer on its health port"; exit 1; }

export ADAPTER_SMOKE_ADAPTER_DIR=. ADAPTER_SMOKE_ADAPTER_KEY=ghostpen ADAPTER_SMOKE_ADAPTER_CONFIG="$dir/adapter.json"
export ADAPTER_SMOKE_CASE_TIMEOUT_MS=60000
chatter="$CHECK_WITH/ensemble-chatter"
# chatter installs through the same deadline-bound install as ghostpen (adapter/scripts/ci-npm-ci.sh).
(cd "$chatter" && bash "$repo/adapter/scripts/ci-npm-ci.sh" && npm run build)
ADAPTER_SMOKE_BASE_DIR="$PWD" node "$chatter/scripts/product-adapter-smoke.mjs"
