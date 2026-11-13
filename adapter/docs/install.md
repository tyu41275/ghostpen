# Installing ghostpen's adapter

ghostpen installs only where the instance's Obsidian `config/stack.yaml` lists `ghostpen` under `adapters:` (ADR 0030). Its Command Center channel appears only there too, through `commandCenter.adapterChannels`, the same way Clock's `clock-alerts` does. Installing never switches it on: that's chatter's Adapters page or direct chat.

**Through Relay** (the normal route; updates go the same way): the catalogue entry for `ghostpen` (Obsidian `personal-instances/personal-infra/relay/stack/adapters.yaml`) names `adapter/scripts/relay-install.mjs`. An instance opts in with `install_inputs: {ghostpen: {port: <1024-65535>, dropin_dir: <absolute>}}` in its `stack.yaml`, with the optional `chatter_facts` and `readiness` (`on` or `off`; any other value is refused, and absent is the install's default, on). Relay runs it in that instance's own checkout, `<root>/checkout`.

**By hand:**

```
adapter/scripts/install-host.sh --instance <instance> --root <root> --port <port> \
  --dropin-dir <chatter's adapters.d> --stack <Obsidian>/ensemble/personal-instances/<instance>/config/stack.yaml \
  [--chatter-facts <chatter's instance-facts.json>] [--readiness on|off]
```

It's idempotent:
- It builds `<root>/checkout/adapter`.
- It creates these once and keeps them on every update (mode 600):
  - `<root>/config/settings.json` (`dataDir` is `<root>/data`);
  - the app identity key `<root>/config/app-identity.key` (32 random bytes);
  - the adapter key `<root>/config/adapter.key` (32 random bytes), which the adapter sends on the service's shortlist routes;
  - `<root>/config/chatter-adapter.json`.
- It writes the user unit `ghostpen-<instance>.service` and chatter's drop-in `ghostpen.json`. The drop-in has `start`/`stop` (enable or disable with `--now`), `health`, `readiness`, and the app (`standalone-app` at `/app/` with the key).
- **Readiness.** The drop-in's `readiness: {port, path: "/readiness"}` sits beside `health`, on the settings' port: chatter reads ghostpen's readiness list there (`docs/readiness.md`, chatter `docs/adapter-readiness.md`). `--readiness off` leaves it out, for a chatter older than the field, which skips a whole drop-in carrying a field it does not know. The default is `on`; any other value is refused before anything is written.

A running service is restarted onto the new build and must answer as this instance before the install reports success. A different `--port` from the kept settings is refused. Settings made before the shortlist gain `adapterKeyFile`, and `instanceFactsFile` from `--chatter-facts` (where the channel chatter made for ghostpen is read). Settings without `appIdentityKeyFile` gain the install's app key, since the readiness list's `app-identity` need names the install as its fix. Values already set are kept. Relay's hook takes `chatter_facts` as an optional input. A container chatter isn't supported yet.
