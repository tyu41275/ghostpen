#!/usr/bin/env bash
# Set up ghostpen's real-browser suite (adapter/e2e) for the browser-e2e check (chatter-ops#27; .github/browser-e2e.json): the
# newest Node 24, as the `test` check uses, then the dependencies and Chromium's headless shell, in the folder the
# check runner names (PLAYWRIGHT_BROWSERS_PATH).
set -euo pipefail
: "${RUNNER_TEMP:?}" "${GITHUB_PATH:?}"
node_ver=$(curl -fsSL --retry 3 https://nodejs.org/dist/index.json | python3 -c 'import json,sys; print(next(r["version"] for r in json.load(sys.stdin) if r["version"].startswith("v24.")))')
mkdir -p "$RUNNER_TEMP/node24"
curl -fsSL --retry 3 "https://nodejs.org/dist/$node_ver/node-$node_ver-linux-x64.tar.xz" | tar -xJ -C "$RUNNER_TEMP/node24" --strip-components=1
export PATH="$RUNNER_TEMP/node24/bin:$PATH"
# The suite's step uses the same Node.
echo "$RUNNER_TEMP/node24/bin" >> "$GITHUB_PATH"
node --version
cd adapter && bash scripts/ci-npm-ci.sh
if ! sudo -n true 2>/dev/null; then
  npx playwright install --only-shell chromium
  exit 0
fi
# System libraries too, where the runner allows it; another job on the same host may hold apt's lock for a while.
attempts="${BROWSER_E2E_DEPS_ATTEMPTS:-6}"
for attempt in $(seq 1 "$attempts"); do
  npx playwright install --with-deps --only-shell chromium && exit 0
  [ "$attempt" -lt "$attempts" ] || break
  echo "browser-e2e setup: installing Chromium failed (attempt $attempt of $attempts); retrying in 30 s" >&2
  sleep 30
done
echo "browser-e2e setup: Chromium could not be installed after $attempts attempts" >&2
exit 1
