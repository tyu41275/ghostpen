#!/usr/bin/env bash
# Builds the two blog sites adapter/e2e/blog.browser.test.ts opens: the repository's own content (legacy mode) in
# .next-e2e-legacy/ and content-sample/ in .next-e2e-sample/. The sample builds last, so its images stay in public/ for
# the test's servers. Runs from anywhere; the browser-e2e setup calls it (adapter/scripts/browser-e2e-setup.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
# The yarn release the repository pins (.yarnrc.yml), so no corepack is needed; HUSKY=0 leaves git's hooks alone.
yarn_js=$(sed -n 's/^yarnPath: *//p' .yarnrc.yml)
yarn() { node "$PWD/$yarn_js" "$@"; }
export HUSKY=0
# A crashing yarn prints its whole minified source line, which buries the error itself in a check's log: keep its output
# in a file and print only its last readable lines when it fails.
log=$(mktemp "${RUNNER_TEMP:-${TMPDIR:?set RUNNER_TEMP or TMPDIR}}/ghostpen-yarn-install.XXXXXX")
if ! yarn install --immutable >"$log" 2>&1; then
  echo "build-e2e-sites: yarn install failed; the end of its output (long lines cut):" >&2
  cut -c1-400 "$log" | tail -n 40 >&2
  rm -f "$log"
  exit 1
fi
rm -f "$log"
GHOSTPEN_DIST_DIR=.next-e2e-legacy yarn build
GHOSTPEN_DIST_DIR=.next-e2e-sample GHOSTPEN_CONTENT_DIR="$PWD/content-sample" yarn build
