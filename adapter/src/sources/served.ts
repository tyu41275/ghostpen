/**
 * Which posts the blog serves (ghostpen#108): the paths in its production sitemap (`<baseUrl>/sitemap.xml`), read once
 * per read of the sources. A post file the site's build left out (an empty date field, say) is not on the blog, so it is
 * no post to link. The sitemap's addresses may carry another host (the starter's `siteUrl`), so only paths are compared.
 * A sitemap that cannot be read is said, never taken as "no post is served".
 */
import type { PublishedSource } from "./config.js";
import type { PublishedIndex, PublishedPost } from "./published.js";

/** One GET of the sitemap; tests pass recorded answers. */
export type SitemapGet = (url: string) => Promise<{ status: number; text: string }>;
/** The paths the site serves, or why they are not known. */
export type Served = { paths: Set<string> } | { problem: string };

const MAX_BYTES = 2 * 1024 * 1024;
const TOO_LARGE = "the blog's sitemap is over 2 MB";

/** The live reader: 10 s, and at most 2 MB of answer. */
export const liveSitemapGet: SitemapGet = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const parts: Uint8Array[] = [];
  const reader = response.body?.getReader();
  for (let size = 0; reader;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error(TOO_LARGE); }
    parts.push(value);
  }
  return { status: response.status, text: Buffer.concat(parts).toString("utf8") };
};

/** A path as compared: no trailing slash, percent-escapes decoded. */
export function pathOf(pathname: string): string {
  const bare = pathname.replace(/\/+$/u, "") || "/";
  try { return decodeURIComponent(bare); } catch { return bare; }
}

/** The path the blog serves a post at: `/blog/<file name without .mdx>`. */
export const postPath = (post: PublishedPost) => pathOf(`/blog/${post.file.replace(/\.mdx?$/u, "")}`);

const unescapeXml = (text: string) => text.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, "&");

/** The sitemap's paths. Never throws; a problem never quotes the address. */
export async function readServed(source: PublishedSource, get: SitemapGet = liveSitemapGet): Promise<Served> {
  let answer: { status: number; text: string };
  try {
    answer = await get(`${source.baseUrl}/sitemap.xml`);
  } catch (error) {
    return { problem: error instanceof Error && error.message === TOO_LARGE ? TOO_LARGE : "the blog's sitemap did not answer" };
  }
  if (answer.status !== 200) return { problem: `the blog's sitemap answered ${answer.status}` };
  const paths = new Set<string>();
  for (const match of answer.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gu)) {
    try { paths.add(pathOf(new URL(unescapeXml(match[1]!)).pathname)); } catch { /* not an address */ }
  }
  // A login page, an index of sitemaps or an empty list is not "nothing is served".
  if (![...paths].some((path) => path.startsWith("/blog/"))) return { problem: "the blog's sitemap lists no posts" };
  return { paths };
}

/** The index with each post's `served` set, in memory only; left unset when the sitemap was not read. */
export function withServed(index: PublishedIndex, served: Served): PublishedIndex {
  if (!("paths" in served)) return index;
  return { ...index, posts: index.posts.map((post) => ({ ...post, served: served.paths.has(postPath(post)) })) };
}
