#!/usr/bin/env bash
# Installs the root dependencies with the yarn release the repository pins (.yarnrc.yml), so no corepack is needed;
# HUSKY=0 leaves git's hooks alone. `scripts/yarn-install.sh <label>`: <label> starts each message it prints.
# yarn 3.6.1 sometimes crashes in its link step under Node 24 ("The `onCancel` handler was attached after the promise
# settled", #141), seen after a cold-cache fetch: that crash, and only that one, gets one more try. A crashing yarn
# prints its whole minified source line, which buries the error in a check's log, so its output goes to a file and only
# its last readable lines are printed when it fails.
set -euo pipefail
cd "$(dirname "$0")/.."
label=${1:-yarn-install}
yarn_js=$(sed -n 's/^yarnPath: *//p' .yarnrc.yml)
export HUSKY=0
log=$(mktemp "${RUNNER_TEMP:-${TMPDIR:?set RUNNER_TEMP or TMPDIR}}/ghostpen-yarn-install.XXXXXX")
trap 'rm -f "$log"' EXIT
crash='The `onCancel` handler was attached after the promise settled'
for attempt in 1 2; do
  node "$PWD/$yarn_js" install --immutable >"$log" 2>&1 && exit 0
  [ "$attempt" = 1 ] && grep -qF "$crash" "$log" || break
  echo "$label: yarn crashed in its link step (#141); installing once more" >&2
done
echo "$label: yarn install failed; the end of its output (long lines cut):" >&2
cut -c1-400 "$log" | tail -n 40 >&2
exit 1
