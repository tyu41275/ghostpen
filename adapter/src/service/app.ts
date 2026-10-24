/**
 * ghostpen's app page (ADR 0101, pattern `adapter-app`): served by chatter's console under its sign-in at
 * `<console>/apps/ghostpen/`, which proxies to `/app/` here. One server-rendered page, every value escaped, styled by
 * the host's shared site look two levels above the app's address. It shows the last ranking (ghostpen#88): every candidate
 * with its scores and the quote behind each, the background posts to write first, the post-mortems owed, and every
 * problem with the sources or the scorer. All in plain words (ADR 0101: a 10-year-old could follow it).
 */
import type { RankingView } from "../ranking/run.js";
import type { AppViewer } from "./app-identity.js";

export const APP_CSP = "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (text: string): string => text.replace(/[&<>"']/gu, (c) => ENTITIES[c] ?? c);

const FACTOR_WORDS: Record<string, string> = { stakes: "Stakes", carryOver: "Carry-over", thoughtProcess: "Thinking",
  evidence: "Evidence", surprise: "Surprise", completeness: "Complete" };

function rankingSection(view: RankingView | null | Error): string {
  if (view instanceof Error) return `<p class="look-danger" data-error="ranking">The last ranking cannot be read: ${escape(view.message)}</p>`;
  if (!view || view.entries.length === 0) {
    return `<p class="look-muted" data-empty="ranking">Nothing is ranked yet. The ranking appears here once ghostpen reads its sources.</p>`;
  }
  const rows = view.entries.map((entry, i) => `<tr data-candidate="${escape(entry.id)}"><td>${i + 1}</td>
<td><strong>${escape(entry.topic)}</strong><br><span class="look-muted">${escape(entry.takeaway)}</span></td>
<td>${entry.kind === "decision" ? "Decision post" : "Post-mortem"}</td><td data-field="total">${entry.total}</td>
<td>${entry.scores.map((s) => `<details><summary>${escape(FACTOR_WORDS[s.factor] ?? s.factor)}: ${s.score}</summary>${s.line
    ? `<blockquote>${escape(s.quote)}</blockquote><span class="look-muted">${escape(s.location)}</span>`
    : `<span class="look-muted">${escape(s.note ?? "no reason given")}</span>`}</details>`).join("")}</td>
<td>${entry.explain.length ? escape(entry.explain.join(", ")) : "<span class=\"look-muted\">nothing</span>"}</td></tr>`).join("");
  return `<p class="look-muted">Ranked ${escape(view.ranAt)}. Every score shows the line it comes from.</p>
<table class="look-table"><thead><tr><th>#</th><th>Topic</th><th>Kind</th><th>Score</th><th>Why</th><th>Needs explaining</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

function backgroundSection(view: RankingView | null | Error): string {
  if (!view || view instanceof Error || view.background.length === 0) return "";
  return `<section class="look-card" data-section="background"><h2>Posts to write first</h2>
<p class="look-muted">Parts of your setup that top topics mention but no post explains yet. Writing these first lets those topics link to them.</p>
<ol>${view.background.map((b) => `<li data-part="${escape(b.part)}">${escape(b.part)}: unlocks ${b.unlocks.length} topic${b.unlocks.length === 1 ? "" : "s"}</li>`).join("")}</ol></section>`;
}

function owedSection(view: RankingView | null | Error): string {
  if (!view || view instanceof Error || view.owed.length === 0) return "";
  return `<section class="look-card" data-section="owed"><h2>Post-mortems owed</h2>
<p class="look-muted">Decision posts written before their outcome. Each needs a follow-up once the outcome is known.</p>
<ul>${view.owed.map((o) => `<li data-owed="${escape(o.decision)}">${escape(o.title)}: ${o.due ? `<strong>due now</strong> (${escape(o.evidence.join(", "))})` : "waiting for the outcome"}</li>`).join("")}</ul></section>`;
}

function problemsSection(view: RankingView | null | Error): string {
  if (!view || view instanceof Error || view.problems.length === 0) return "";
  return `<section class="look-card" data-section="problems"><h2>Problems</h2><p class="look-muted">Sources ghostpen could not read, and topics it could not score.</p>
<ul>${view.problems.map((p) => `<li>${escape(p)}</li>`).join("")}</ul></section>`;
}

export function renderApp(instance: string, viewer: AppViewer, view: RankingView | null | Error = null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ghostpen — ${escape(instance)}</title><link rel="stylesheet" href="../../look/ghostpen.css"><script src="../../look/mode.js"></script></head>
<body><main class="look-main">
<header><h1>ghostpen — ${escape(instance)}</h1><p class="look-muted">Signed in as ${escape(viewer.login)}
  <button type="button" class="look-btn look-ghost" data-look-toggle>Mode</button> <a class="look-btn look-ghost" data-look-console hidden>Chatter</a></p></header>
<section class="look-card" data-section="about"><h2>What ghostpen does</h2>
<p>ghostpen helps write the blog. It reads the decisions behind the work, picks the ones most worth a post, and drafts
posts that explain every part of the setup they mention. Nothing is published until you press Publish.</p></section>
<section class="look-card" data-section="ranking"><h2>Topic ranking</h2>
${rankingSection(view)}</section>
${backgroundSection(view)}${owedSection(view)}${problemsSection(view)}
</main></body></html>`;
}
