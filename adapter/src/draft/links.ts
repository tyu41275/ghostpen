/**
 * The link check (ghostpen#108): every link a draft makes to one of the blog's posts (`/blog/<slug>`, by path or by the
 * blog's own address, inline, by reference or as an `href`, outside code) leads to a post the site serves. A post file that is a draft, or that the site's
 * build left out, is no post yet; a slug with no file is none at all. Other paths and other sites are not checked.
 * When the blog's sitemap was not read, a post link cannot be checked and fails as such, never passes.
 */
import { pathOf, postPath, type Served } from "../sources/served.js";
import type { PublishedIndex } from "../sources/published.js";
import { linkTargets, outsideCode } from "./stack-parts.js";

export const LINKS_CHECK = "Every link leads to a post the blog serves";
const SHOWN = 5;

export interface LinksContext {
  /** `sources.published.baseUrl`; unset when no blog is configured. */
  baseUrl?: string;
  served?: Served;
  index: PublishedIndex;
}

/** The draft's links to the blog's posts, as `/blog/<slug>` paths, each once. */
export function postLinks(markdown: string, baseUrl?: string): string[] {
  const origin = baseUrl ? new URL(baseUrl).origin : undefined;
  const text = outsideCode(markdown);
  const hrefs = [...text.matchAll(/\bhref\s*=\s*\{?\s*["']([^"'\s]+)["']/gu)].map((m) => m[1]!);
  // Reference definitions, for `[text][name]` links: `[name]: /blog/slug`.
  const refs = [...text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?/gmu)].map((m) => m[1]!);
  const out = new Set<string>();
  for (const target of [...linkTargets(markdown), ...hrefs, ...refs]) {
    const local = target.startsWith("/") && !target.startsWith("//");
    let url: URL;
    try { url = new URL(target, baseUrl ?? "http://blog.invalid"); } catch { continue; }
    if (!local && url.origin !== origin) continue;
    const path = pathOf(url.pathname);
    if (/^\/blog\/.+$/u.test(path) && !/^\/blog\/page\/\d+$/u.test(path)) out.add(path);
  }
  return [...out];
}

/** `unknown`: a link could not be checked (no blog configured, or its sitemap unread): rewording cannot fix that. */
export function checkLinks(markdown: string, context: LinksContext): { passed: boolean; findings: string[]; unknown: boolean } {
  const links = postLinks(markdown, context.baseUrl);
  const all: string[] = [];
  let unknown = false;
  for (const link of links) {
    if (!context.baseUrl) { unknown = true; all.push(`the link ${link} cannot be checked: sources.published is not set`); continue; }
    const served = context.served;
    if (served && "paths" in served && served.paths.has(link)) continue;
    const post = context.index.posts.find((p) => postPath(p) === link);
    if (!post) all.push(`the link ${link} leads to no post: take it out or link a post that is on the blog`);
    else if (post.draft) all.push(`the link ${link} leads to a draft: it is not on the blog yet`);
    else if (!served || "problem" in served) {
      unknown = true;
      all.push(`the link ${link} cannot be checked: ${served ? served.problem : "the blog's sitemap was not read"}`);
    } else all.push(`the link ${link} leads to a post the site does not serve: its build left it out, or it is not deployed yet`);
  }
  const findings = all.length > SHOWN ? [...all.slice(0, SHOWN), `${all.length - SHOWN} more links do not work`] : all;
  return { passed: all.length === 0, findings, unknown };
}
