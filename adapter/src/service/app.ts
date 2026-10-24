/**
 * ghostpen's app page (ADR 0101, pattern `adapter-app`): served by chatter's console under its sign-in at
 * `<console>/apps/ghostpen/`, which proxies to `/app/` here. One server-rendered page, every value escaped, styled by
 * the host's shared site look two levels above the app's address. The ranking view comes with ghostpen#88; until then
 * the page says what ghostpen is and that nothing is ranked yet, in plain words (ADR 0101: a 10-year-old could follow it).
 */
import type { AppViewer } from "./app-identity.js";

export const APP_CSP = "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (text: string): string => text.replace(/[&<>"']/gu, (c) => ENTITIES[c] ?? c);

export function renderApp(instance: string, viewer: AppViewer): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ghostpen — ${escape(instance)}</title><link rel="stylesheet" href="../../look/ghostpen.css"><script src="../../look/mode.js"></script></head>
<body><main class="look-main">
<header><h1>ghostpen — ${escape(instance)}</h1><p class="look-muted">Signed in as ${escape(viewer.login)}
  <button type="button" class="look-btn look-ghost" data-look-toggle>Mode</button> <a class="look-btn look-ghost" data-look-console hidden>Chatter</a></p></header>
<section class="look-card" data-section="about"><h2>What ghostpen does</h2>
<p>ghostpen helps write the blog. It reads the decisions behind the work, picks the ones most worth a post, and drafts
posts that explain every part of the setup they mention. Nothing is published until you press Publish.</p></section>
<section class="look-card" data-section="ranking"><h2>Topic ranking</h2>
<p class="look-muted" data-empty="ranking">Nothing is ranked yet. The ranking appears here once ghostpen reads its sources.</p></section>
</main></body></html>`;
}
