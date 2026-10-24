# Installing ghostpen's adapter

ghostpen installs only where the instance's Obsidian `config/stack.yaml` lists `ghostpen` under `adapters:` (ADR 0030). Its Command Center channel appears only there too, through `commandCenter.adapterChannels`, the same way Clock's `clock-alerts` does. Installing never switches it on: that's chatter's Adapters page or direct chat.

**Through Relay** (the normal route; updates go the same way): the catalogue entry for `ghostpen` (Obsidian `personal-instances/personal-infra/relay/stack/adapters.yaml`) names `adapter/scripts/relay-install.mjs`. An instance opts in with `install_inputs: {ghostpen: {port: <1024-65535>, dropin_dir: <absolute>}}` in its `stack.yaml`. Relay runs it in that instance's own checkout, `<root>/checkout`.

**By hand:**

```
adapter/scripts/install-host.sh --instance <instance> --root <root> --port <port> \
  --dropin-dir <chatter's adapters.d> --stack <Obsidian>/ensemble/personal-instances/<instance>/config/stack.yaml
```

It's idempotent:
- It builds `<root>/checkout/adapter`.
- It creates these once and keeps them on every update (mode 600):
  - `<root>/config/settings.json` (`dataDir` is `<root>/data`);
  - the app identity key `<root>/config/app-identity.key` (32 random bytes);
  - `<root>/config/chatter-adapter.json`.
- It writes the user unit `ghostpen-<instance>.service` and chatter's drop-in `ghostpen.json`. The drop-in has `start`/`stop` (enable or disable with `--now`), `health`, and the app (`standalone-app` at `/app/` with the key).

A running service is restarted onto the new build and must answer as this instance before the install reports success. A different `--port` from the kept settings is refused. A container chatter isn't supported yet.
