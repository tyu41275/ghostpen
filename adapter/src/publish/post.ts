/**
 * A draft as a blog post file (ghostpen#90): the blog's frontmatter (title, date, tags, summary, `aiGenerated: true`
 * so the post carries the blog's AI banner, never `draft`), screenshot references turned into the blog's image
 * addresses, and the file and image names the post goes under.
 */
import type { Draft } from "../draft/write.js";

/** The post's file name stem: its title in lower case, letters and digits joined by dashes, at most 80 characters. */
export function slugOf(title: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80).replace(/-+$/u, "");
  return slug || "post";
}

const quote = (text: string) => `'${text.replace(/'/gu, "''")}'`;

/** The post file's text. `imagesUrl` is where the blog serves this post's screenshots (`<imagesUrl>/<slug>/<name>.png`). */
export function postText(draft: Draft, date: string, slug: string, imagesUrl: string): string {
  const body = draft.markdown.replace(/!\[([^\]]*)\]\(screenshot:([A-Za-z0-9_-]+)\)/gu,
    (_all, alt: string, name: string) => `![${alt}](${imagesUrl.replace(/\/+$/u, "")}/${slug}/${name}.png)`);
  return ["---", `title: ${quote(draft.title)}`, `date: '${date}'`, `tags: [${draft.tags.map(quote).join(", ")}]`, "draft: false", "aiGenerated: true",
    `summary: ${quote(draft.summary)}`, "---", "", body.trim(), ""].join("\n");
}
