/**
 * What ghostpen reads (ADR 0101, brief D8). Every item keeps where it came from (a file and line, or a URL), so a score
 * can quote the exact line that earns it, and every source that cannot be read is reported by name, never treated as
 * empty.
 */

/** Where a piece of text is: a file (absolute path) and its 1-based line, or a web address. */
export interface Location { path?: string; line?: number; url?: string }

/** A topic source's document: a decision record, a GitHub issue or pull request, or an experiment record. */
export interface TopicDocument {
  /** Stable across reads: the source's name and the document's own id (a relative path, or owner/repo#number). */
  id: string;
  kind: "decision" | "issue" | "pull" | "experiment";
  source: string;
  title: string;
  /** The document's lines, in order; a quote is one of these with its location. */
  lines: string[];
  location: Location;
  /** When it was last changed (ISO), when the source says. */
  updated?: string;
}

/** One definition of a stack part, from a glossary's `## Term` section. */
export interface Definition { term: string; text: string; location: Location; source: string }

/** A source that could not be read, and why: shown to the operator, never silently empty. */
export interface SourceProblem { source: string; problem: string }

export interface Read<T> { items: T[]; problems: SourceProblem[] }
