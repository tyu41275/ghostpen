/**
 * The stack-part check (ADR 0101, brief D1 and D3): every part of the author's setup a draft names (a glossary term) is
 * handled. A part with a published post must link that post. A part with no post that is **central** to the draft (in
 * its title, or named three times or more) holds the draft: its background post is written first. A part only mentioned
 * in passing must be explained where it first appears, and goes on the "posts to write later" list.
 *
 * "Explained" is a rule, not an opinion: within the 12 words after the part's first mention, its paragraph carries an
 * explaining phrase (" is ", " are ", " (", " — ", " - ", ", a ", ", an ", ", the ", ", which ", ": a ", ": an ").
 */
import { postsAbout, type PublishedIndex } from "../sources/published.js";
import { prose } from "./plain.js";

export interface StackPartResult {
  passed: boolean;
  findings: string[];
  /** Central parts with no post: their background posts come first; the draft waits. */
  hold: string[];
  /** Parts explained in passing: posts to write later. */
  later: string[];
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const termRe = (term: string, flags = "giu") => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term)}(?=$|[^A-Za-z0-9])`, flags);
const EXPLAINS = [" is ", " are ", " (", " — ", " - ", ", a ", ", an ", ", the ", ", which ", ": a ", ": an "];

/** Whether the paragraph explains `term` right after its first mention. */
function explained(paragraph: string, term: string): boolean {
  const match = termRe(term, "iu").exec(paragraph);
  if (!match) return false;
  const window = ` ${paragraph.slice(match.index + match[0].length).split(/\s+/u).slice(0, 13).join(" ")} `.toLowerCase();
  return EXPLAINS.some((phrase) => window.includes(phrase));
}

export function checkStackParts(title: string, markdown: string, terms: string[], index: PublishedIndex): StackPartResult {
  const text = prose(markdown);
  const wanted = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))];
  const findings: string[] = [], hold: string[] = [], later: string[] = [];
  for (const term of wanted) {
    const count = (text.match(termRe(term)) ?? []).length + (termRe(term, "iu").test(title) ? 1 : 0);
    if (count === 0) continue;
    const posts = postsAbout(index, term);
    if (posts.length > 0) {
      const post = posts[0]!;
      const path = new URL(post.url).pathname;
      if (!markdown.includes(post.url) && !markdown.includes(`](${path})`)) findings.push(`${term} has a post: link ${post.url} where it first appears`);
      continue;
    }
    if (termRe(term, "iu").test(title) || count >= 3) {
      hold.push(term);
      findings.push(`${term} is central to this draft and has no post yet: write its background post first`);
      continue;
    }
    const paragraph = text.split(/\n\s*\n/u).find((p) => termRe(term, "iu").test(p)) ?? "";
    if (!explained(paragraph, term)) findings.push(`${term} has no post: explain it in a few plain words where it first appears`);
    else later.push(term);
  }
  return { passed: findings.length === 0, findings, hold, later };
}
