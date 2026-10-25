/**
 * The plain-language check (ADR 0101, brief D2: everything ghostpen writes must be explainable to a 10-year-old). It is
 * a rule anyone can rerun, not a model's opinion: the Flesch-Kincaid grade of the draft's prose must be at most
 * `maxGrade` (default 8) and no sentence may run past `maxSentenceWords` (default 30). Code blocks, diagrams, link
 * addresses and headings are not prose and are left out. A failure names the grade and the longest sentences.
 */

export interface PlainOptions { maxGrade: number; maxSentenceWords: number }
export const PLAIN_DEFAULTS: PlainOptions = { maxGrade: 8, maxSentenceWords: 30 };

/** The draft's prose: no fenced blocks, inline code, link addresses, images, headings, tables or HTML. */
export function prose(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/u, "")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\n]*`/gu, " code ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .split("\n").filter((line) => !/^\s*(#|\||>?\s*$)/u.test(line)).join("\n");
}

/** Rough English syllables: vowel groups, a silent final "e" dropped, at least one per word. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/gu, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, "").replace(/^y/u, "").match(/[aeiouy]{1,2}/gu);
  return Math.max(1, groups?.length ?? 1);
}

/** Sentences: a stop then a capital starts a new one, and so does a blank line. */
export function sentencesOf(text: string): string[] {
  return text.split(/\n\s*\n/u)
    .flatMap((paragraph) => paragraph.replace(/\s+/gu, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/u))
    .map((s) => s.trim()).filter((s) => /[A-Za-z]/u.test(s));
}

const wordsOf = (sentence: string) => sentence.split(/\s+/u).filter((w) => /[A-Za-z0-9]/u.test(w));

export interface PlainResult { passed: boolean; grade: number; findings: string[] }

export function checkPlain(markdown: string, options: PlainOptions = PLAIN_DEFAULTS): PlainResult {
  const sentences = sentencesOf(prose(markdown));
  const words = sentences.flatMap(wordsOf);
  if (words.length === 0) return { passed: false, grade: 0, findings: ["the draft has no prose to read"] };
  const syll = words.reduce((sum, w) => sum + syllables(w), 0);
  const grade = Math.round((0.39 * (words.length / sentences.length) + 11.8 * (syll / words.length) - 15.59) * 10) / 10;
  const long = sentences.map((s) => ({ s, n: wordsOf(s).length })).filter((x) => x.n > options.maxSentenceWords).sort((a, b) => b.n - a.n);
  const findings: string[] = [];
  if (grade > options.maxGrade) findings.push(`reading grade ${grade} is above ${options.maxGrade}: use shorter sentences and simpler words`);
  for (const { s, n } of long.slice(0, 3)) findings.push(`a ${n}-word sentence (at most ${options.maxSentenceWords}): "${s.slice(0, 120)}${s.length > 120 ? "…" : ""}"`);
  if (long.length > 3) findings.push(`${long.length - 3} more sentences are too long`);
  return { passed: findings.length === 0, grade, findings };
}
