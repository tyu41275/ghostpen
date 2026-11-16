#!/usr/bin/env bash
# Builds the live blog on this host from the content folder GHOSTPEN_CONTENT_DIR names and sends the finished site to
# Vercel as a prebuilt deployment, so the content never leaves the host (README.md, "Deploying the live site").
#   scripts/deploy-site.sh               pull the project settings, build, deploy to production
#   scripts/deploy-site.sh --build-only  pull and build only, and print where the build is
# Inputs, from the environment only: GHOSTPEN_CONTENT_DIR, VERCEL_TOKEN_FILE (a file holding the token; or VERCEL_TOKEN),
# VERCEL_ORG_ID and VERCEL_PROJECT_ID (the Vercel CLI reads these two itself). Runs from anywhere.
set -euo pipefail
set +x # never trace: the token is on the CLI's command lines

# The Vercel CLI release every call runs. To bump it: `npm view vercel version`, put that here, run --build-only.
VERCEL_CLI_VERSION=65.16.0

cd "$(dirname "$0")/.."
build_only=0
for arg in "$@"; do
  case "$arg" in
    --build-only) build_only=1 ;;
    *) echo "deploy-site: unknown argument: $arg (only --build-only)" >&2; exit 2 ;;
  esac
done

missing=()
[ -n "${GHOSTPEN_CONTENT_DIR:-}" ] || missing+=(GHOSTPEN_CONTENT_DIR)
[ -n "${VERCEL_TOKEN_FILE:-}" ] || [ -n "${VERCEL_TOKEN:-}" ] || missing+=("VERCEL_TOKEN_FILE (or VERCEL_TOKEN)")
[ -n "${VERCEL_ORG_ID:-}" ] || missing+=(VERCEL_ORG_ID)
[ -n "${VERCEL_PROJECT_ID:-}" ] || missing+=(VERCEL_PROJECT_ID)
if [ ${#missing[@]} -gt 0 ]; then
  joined=$(printf ', %s' "${missing[@]}")
  echo "deploy-site: missing ${joined:2}" >&2
  exit 2
fi

# An inherited `token` would keep its export when assigned, and so reach every process below: start from none.
unset token
if [ -n "${VERCEL_TOKEN_FILE:-}" ]; then
  if [ ! -r "$VERCEL_TOKEN_FILE" ]; then
    echo "deploy-site: VERCEL_TOKEN_FILE ($VERCEL_TOKEN_FILE) is not a readable file" >&2
    exit 2
  fi
  token=$(tr -d '[:space:]' <"$VERCEL_TOKEN_FILE")
else
  token=$VERCEL_TOKEN
fi
if [ -z "$token" ]; then
  echo "deploy-site: the Vercel token is empty" >&2
  exit 2
fi
# The build and anything it starts see neither the token nor where it is.
unset VERCEL_TOKEN VERCEL_TOKEN_FILE

# The build must read the content folder, never the repository's own content, and write .next/ where Vercel looks.
export GHOSTPEN_REQUIRE_CONTENT=1
unset GHOSTPEN_DIST_DIR

# The root dependencies (scripts/yarn-install.sh: the pinned yarn, its link-step crash tried once more). HUSKY=0 stays
# set for the CLI too, as `vercel build` may run its own install.
export HUSKY=0
TMPDIR="${TMPDIR:-/tmp}" bash scripts/yarn-install.sh deploy-site

vercel() { npx --yes "vercel@$VERCEL_CLI_VERSION" "$@" --token "$token"; }

vercel pull --yes --environment=production
# `vercel build` loads the variables pull wrote; one of the project's own GHOSTPEN_* there could undo the lines above.
pulled=.vercel/.env.production.local
if [ -f "$pulled" ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?GHOSTPEN_' "$pulled"; then
  echo "deploy-site: the Vercel project sets GHOSTPEN_* variables for production ($pulled); remove them there" >&2
  exit 1
fi
# Runs the project's own build (`yarn build`: next build, whose next.config.js prepares the content, then postbuild).
vercel build --prod
if [ "$build_only" = 1 ]; then
  echo "deploy-site: built into $PWD/.vercel/output (not deployed)"
  exit 0
fi
url=$(vercel deploy --prebuilt --prod)
echo "deploy-site: deployed $url"
