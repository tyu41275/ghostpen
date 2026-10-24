# ghostpen's chatter adapter and service

ghostpen is an optional chatter adapter (Obsidian ADR 0101 and ADR 0030). Chatter loads this package's built adapter (`dist/adapter`) only while ghostpen is allowed in the instance's Obsidian `stack.yaml` and switched on from the Adapters page. Switching it off runs the drop-in's `stop`, which stops ghostpen's service; its data is kept. The blog in the repo root keeps building and deploying as before. This folder is only the adapter.

- **Its own service** (`node dist/service/main.js <settings.json>`), on loopback. It answers:
  - **`GET /health`:** `{ok, instance, version}`. It checks the data folder on every request. A missing or unwritable folder answers 503 with the reason (`dataDir: <dir> is not a folder` or `cannot be written`). Chatter's Adapters page probes it through the drop-in's `optional.health`.
  - **`/app/`:** the app page, following the `adapter-app` pattern (Obsidian `ensemble/products/fleet/patterns/adapter-app.md`):
    - it opens only to a request whose `X-Chatter-Identity` header is signed with the key in `appIdentityKeyFile`, for audience `ghostpen`, and not expired (`src/service/app-identity.ts`, the same check as Tempo's);
    - any other request gets 404, and with no key file set the app opens to nobody;
    - a key file that's named but unreadable or under 32 bytes stops the start;
    - it sends a strict CSP, `no-store` and `nosniff`, and escapes every value;
    - it's styled by the shared site look. The ranking view comes with ghostpen#88.
  - Every other path is 404.
- **Settings** (`src/settings.ts`): `instance`, `port` (1024–65535), `dataDir` (absolute, must exist), and an optional `appIdentityKeyFile`. They're written from the operator's own config; no machine-specific value lives in code. Errors name the field, never the value.
- **`status`** (a command and an agent tool) replies `ghostpen for <instance> is on and answering.`, or `ghostpen is not answering (<why>).` It never throws.
- **Version:** the adapter's `version` is the chatter adapter API it's written against (1.0.0), not ghostpen's own (`src/version.ts`).
- **Ranking:** `docs/ranking.md`: candidates, quote-checked scores, background posts, post-mortems owed and weight suggestions.
- **Sources:** `docs/sources.md`: what ghostpen reads, as the settings' `sources` block names it.
- **Install:** `docs/install.md` covers `scripts/install-host.sh`, Relay's `scripts/relay-install.mjs`, and the drop-in with the app.
- **CI** (`.ci/checks.json` and `.github/browser-e2e.json` in the repo root):
  - `test`: typecheck, the fast tests and file sizes;
  - `slow-tests`: scheduled;
  - `adapter-smoke`: chatter's `product-adapter-smoke.mjs` over `smoke/cases.json` against a real service;
  - `browser-e2e`: the app page in Chromium.

```
cd adapter && npm ci && npm run typecheck && npm test
npx playwright install --only-shell chromium && npm run test:browser   # the app page in real Chromium (e2e/)
```
