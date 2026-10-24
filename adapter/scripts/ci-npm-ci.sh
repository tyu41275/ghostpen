#!/usr/bin/env bash
# `npm ci --no-audit --no-fund` for the check runner's jobs (.ci/checks.json), with a deadline per attempt (tyu41275/Clock#34, tyu41275/Clock#57; copied from Reflection).
# On the CI VMs about one install in twelve hangs: a registry connection stops mid-download or mid-TLS-handshake behind the
# VMs' NAT and the kernel holds it ~15.5 min (tyu41275/chatter-ops#151); a good install takes seconds. --fetch-timeout fails a
# stalled download after 60 s so npm retries it; a hung attempt is stopped at the deadline, its last requests are printed
# and the install starts again (npm ci removes node_modules first). Any other failure exits at once with npm's own status.
# NPM_CI_DEADLINE_S (default 180), NPM_CI_ATTEMPTS (default 3) and NPM_CI_KILL_AFTER_S (default 10: a hung npm ignores
# SIGTERM) bound it.
set -uo pipefail
deadline="${NPM_CI_DEADLINE_S:-180}" attempts="${NPM_CI_ATTEMPTS:-3}" kill_after="${NPM_CI_KILL_AFTER_S:-10}"
for ((attempt = 1; ; attempt++)); do
  timeout -k "$kill_after" "$deadline" npm ci --no-audit --no-fund --fetch-timeout=60000 "$@"
  status=$?
  [ "$status" -eq 0 ] && exit 0
  # 124: the deadline passed; 137: it then needed SIGKILL. Anything else is npm's own failure.
  if [ "$status" -ne 124 ] && [ "$status" -ne 137 ]; then echo "npm-ci: npm ci failed (exit $status)" >&2; exit "$status"; fi
  echo "npm-ci: the install hung past ${deadline}s (attempt $attempt of $attempts); its last requests:" >&2
  log="$(ls -t "${HOME:-.}"/.npm/_logs/*-debug-*.log 2>/dev/null | head -n 1)"
  if [ -n "$log" ]; then grep -E "http fetch|timing" "$log" | tail -n 8 >&2; else echo "  (no npm debug log)" >&2; fi
  [ "$attempt" -ge "$attempts" ] && exit "$status"
done
