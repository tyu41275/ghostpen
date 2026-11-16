#!/usr/bin/env bash
# Builds the two blog sites adapter/e2e/blog.browser.test.ts opens: the repository's own content (legacy mode) in
# .next-e2e-legacy/ and content-sample/ in .next-e2e-sample/. The sample builds last, so its images stay in public/ for
# the test's servers. Runs from anywhere; the browser-e2e setup calls it (adapter/scripts/browser-e2e-setup.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/yarn-install.sh build-e2e-sites
yarn_js=$(sed -n 's/^yarnPath: *//p' .yarnrc.yml)
yarn() { node "$PWD/$yarn_js" "$@"; }
GHOSTPEN_DIST_DIR=.next-e2e-legacy yarn build
GHOSTPEN_DIST_DIR=.next-e2e-sample GHOSTPEN_CONTENT_DIR="$PWD/content-sample" yarn build
