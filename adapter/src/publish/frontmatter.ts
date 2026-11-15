/**
 * The blog's date fields (ghostpen#108): Contentlayer's Blog type (`contentlayer.config.ts`) has `date` (required) and
 * `lastmod`, both `type: 'date'`. A post whose date field is empty or not a date is left out of the site's build, so its
 * address answers 404 though its file is in the repo. A post file ghostpen writes is checked before it is committed;
 * `test/blog-frontmatter.test.ts` holds every post in the repo, and this list, to the same rule.
 */
import { frontmatter } from "../sources/published.js";

export const DATE_FIELDS = ["date", "lastmod"] as const;
export const REQUIRED_DATES: readonly string[] = ["date"];
const DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/u;

/** What is wrong with the post's date fields, in plain words; none when they are right. */
export function dateProblems(text: string): string[] {
  const { fields } = frontmatter(text);
  const problems: string[] = [];
  for (const field of DATE_FIELDS) {
    const value = fields[field];
    const required = REQUIRED_DATES.includes(field);
    if (value === undefined) {
      if (required) problems.push(`${field} is missing`);
    } else if (typeof value === "string" && value.trim() === "") {
      problems.push(required ? `${field} is empty: give a date` : `${field} is empty: give a date or leave the line out`);
    } else if (typeof value !== "string" || !DATE.test(value.trim()) || Number.isNaN(Date.parse(value.trim()))) {
      problems.push(`${field} is not a date: give it as YYYY-MM-DD`);
    }
  }
  return problems;
}
