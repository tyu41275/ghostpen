#!/usr/bin/env bash
# Install or update one instance's ghostpen adapter on this host (adapter/docs/install.md). Idempotent: it builds the
# given checkout's adapter/, creates the settings, the app key and the adapter config once (never overwriting them),
# installs the user service, and writes chatter's adapter drop-in. It installs only where the instance's Obsidian
# stack.yaml (--stack) allows ghostpen, and does not switch ghostpen on: that is the chatter Adapters page or direct
# chat (ADR 0030).
#
#   adapter/scripts/install-host.sh --instance personal-comms-host --root ~/.ductor/host-chatter/ghostpen \
#     --port 8794 --dropin-dir ~/.ductor/host-chatter/adapters.d \
#     --stack <Obsidian checkout>/ensemble/personal-instances/personal-comms-host/config/stack.yaml \
#     [--chatter-facts ~/.ductor/host-chatter/runtime/data/instance-facts.json]
set -euo pipefail
# Tests only: a stand-in for systemctl; skipping the build of an already built checkout; a shorter wait for a restarted
# service to answer.
SYSTEMCTL="${GHOSTPEN_INSTALL_SYSTEMCTL:-systemctl}"

INSTANCE= ROOT= PORT= DROPIN= STACK= FACTS=
while [ $# -gt 0 ]; do
  case "$1" in
    --instance) INSTANCE=$2 ;; --root) ROOT=$2 ;; --port) PORT=$2 ;; --dropin-dir) DROPIN=$2 ;; --stack) STACK=$2 ;;
    --chatter-facts) FACTS=$2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift 2
done
for v in INSTANCE ROOT PORT DROPIN STACK; do [ -n "${!v}" ] || { echo "missing --${v,,}" >&2; exit 2; }; done
for v in ROOT DROPIN; do case "${!v}" in /*) ;; *) echo "--${v,,} must be absolute" >&2; exit 2 ;; esac; done
case "$FACTS" in ""|/*) ;; *) echo "--chatter-facts must be absolute" >&2; exit 2 ;; esac
CHECKOUT="$ROOT/checkout" CONFIG="$ROOT/config" DATA="$ROOT/data"
ADAPTER="$CHECKOUT/adapter"
UNIT="ghostpen-$INSTANCE.service"
# Installed only where the instance allows it (ADR 0030): checked before anything is configured or built. The check
# reads the file with the yaml parser chatter uses, so a checkout without its dependencies gets them first.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$HERE/node_modules/yaml/package.json" ] || (cd "$HERE" && npm ci --no-audit --no-fund --silent)
node "$HERE/scripts/allowed-here.mjs" "$STACK" "$INSTANCE" || exit 1
[ -d "$CHECKOUT/.git" ] || { echo "no checkout at $CHECKOUT: clone tyu41275/ghostpen there first" >&2; exit 1; }

install -d -m 700 "$CONFIG" "$DATA"
[ -n "${GHOSTPEN_INSTALL_SKIP_BUILD:-}" ] || (cd "$ADAPTER" && npm ci --no-audit --no-fund --silent && npm run -s build)

umask 077
# The key chatter's console signs app viewers with (src/service/app-identity.ts); chatter reads it from the drop-in.
APP_KEY="$CONFIG/app-identity.key"
[ -s "$APP_KEY" ] || node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > "$APP_KEY"
SETTINGS="$CONFIG/settings.json"
[ -s "$SETTINGS" ] || node -e 'const [i,p,d,k]=process.argv.slice(1);
  process.stdout.write(JSON.stringify({instance:i,port:Number(p),dataDir:d,appIdentityKeyFile:k},null,2)+"\n")' \
  "$INSTANCE" "$PORT" "$DATA" "$APP_KEY" > "$SETTINGS"
# The settings are kept across updates, and the service listens on their port: the unit and chatter's health check
# must name the same one, so a different --port is refused rather than half applied.
# The key the adapter sends on the service's adapter routes (ghostpen#89), and chatter's facts (where the channel chatter
# made for ghostpen is read): settings made before either existed gain them; every value already there is kept.
ADAPTER_KEY="$CONFIG/adapter.key"
[ -s "$ADAPTER_KEY" ] || node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > "$ADAPTER_KEY"
node -e 'const fs=require("node:fs"); const [f,k,facts]=process.argv.slice(1); const s=JSON.parse(fs.readFileSync(f,"utf8")); let changed=false;
  if (s.adapterKeyFile === undefined) { s.adapterKeyFile=k; changed=true; }
  if (facts && s.instanceFactsFile === undefined) { s.instanceFactsFile=facts; changed=true; }
  if (changed) { fs.writeFileSync(f+".tmp",JSON.stringify(s,null,2)+"\n"); fs.renameSync(f+".tmp",f); }' "$SETTINGS" "$ADAPTER_KEY" "$FACTS"
KEPT_PORT=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).port))' "$SETTINGS")
[ "$KEPT_PORT" = "$PORT" ] || { echo "--port $PORT differs from port $KEPT_PORT in $SETTINGS: edit the settings file to move ghostpen" >&2; exit 1; }
KEPT_KEY=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).appIdentityKeyFile ?? ""))' "$SETTINGS")
ADAPTER_CONFIG="$CONFIG/chatter-adapter.json"
[ -s "$ADAPTER_CONFIG" ] || node -e 'process.stdout.write(JSON.stringify({settingsFile:process.argv[1]},null,2)+"\n")' "$SETTINGS" > "$ADAPTER_CONFIG"
umask 022

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
install -d "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT.tmp" <<UNITEOF
[Unit]
Description=ghostpen for $INSTANCE (health and app on loopback :$PORT)

[Service]
ExecStart=$(command -v node) $ADAPTER/dist/service/main.js $SETTINGS
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNITEOF
mv "$UNIT_DIR/$UNIT.tmp" "$UNIT_DIR/$UNIT"
"$SYSTEMCTL" --user daemon-reload
# Running already: restart onto the new build. Stopped (switched off): leave it stopped; the switch starts it.
RESTARTED=
if "$SYSTEMCTL" --user is-active --quiet "$UNIT"; then "$SYSTEMCTL" --user restart "$UNIT"; RESTARTED=1; fi

install -d -m 700 "$DROPIN"
# The switch enables or disables the unit with starting or stopping it: an on ghostpen comes back after a reboot by
# itself, an off one stays off. It runs no jobs yet, so none to cancel. Its app opens from chatter's console at
# apps/ghostpen/ (chatter docs/optional-adapters.md, "The apps"); with no key in the settings the drop-in names none.
node -e 'const [key,mod,cfg,unit,port,appKey]=process.argv.slice(1); const run=(a)=>["systemctl","--user",a,"--now",unit];
  const optional={label:"ghostpen",start:run("enable"),stop:run("disable"),cancelJobs:["/bin/true"],
    health:{port:Number(port),path:"/health"}};
  if (appKey) optional.app={kind:"standalone-app",port:Number(port),path:"/app/",identityKeyFile:appKey};
  process.stdout.write(JSON.stringify({version:1,key,entry:{key,module:mod,config:cfg,namespaces:[key],optional}},null,2)+"\n")' \
  ghostpen "$ADAPTER" "$ADAPTER_CONFIG" "$UNIT" "$PORT" "$KEPT_KEY" > "$DROPIN/ghostpen.json.tmp"
chmod 600 "$DROPIN/ghostpen.json.tmp"
mv "$DROPIN/ghostpen.json.tmp" "$DROPIN/ghostpen.json"
# A restarted service must answer as this instance before the install reports success: the restart returns before the
# service listens, and the new build may not start at all.
if [ -n "$RESTARTED" ]; then
  node -e 'const [port,instance,wait]=process.argv.slice(1); const end=Date.now()+Number(wait)*1000;
    (async()=>{ for(;;){ try { const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(2000)});
      if (r.ok && (await r.json()).instance===instance) return; } catch {}
      if (Date.now()>end) process.exit(1); await new Promise((ok)=>setTimeout(ok,250)); } })();' \
    "$PORT" "$INSTANCE" "${GHOSTPEN_INSTALL_HEALTH_WAIT:-30}" \
    || { echo "ghostpen for $INSTANCE was restarted but does not answer as it on 127.0.0.1:$PORT/health: see journalctl --user -u $UNIT" >&2; exit 1; }
fi
echo "ghostpen for $INSTANCE installed: unit $UNIT, settings $SETTINGS, drop-in $DROPIN/ghostpen.json"
