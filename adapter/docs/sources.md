# What ghostpen reads (ghostpen#87, ADR 0101 brief D8)

ghostpen reads only what its settings' `sources` block names. Nothing in the code knows Obsidian or any one person's folders. A source that can't be read (a missing folder, a pattern matching nothing, a link leading out of its folder, a repository GitHub refuses) is reported by name. It's never treated as empty. Every item keeps where it came from: a file and line, or a web address. That way a score can quote the exact line that earns it.

| Block | Kind | What it gives | Code |
|---|---|---|---|
| `topics[]` | `markdown`: `root`, `include` globs (inside root), `as` = `decision` (default) or `experiment` | each file as a topic document: title (first `# ` heading, else the file name) and every line | `src/sources/markdown.ts` |
| `topics[]` | `github`: `repos`, `incidentLabel`, `measuredPattern` (a case-insensitive regular expression), `days` (default 60), optional `tokenFile` | issues carrying the label, and merged PRs whose body matches the pattern, each as a topic document located by its URL | `src/sources/github.ts` |
| `references[]` | `glossary`: `root`, `include` | each `## Term` section: the term, its text up to the next heading, and the heading's line | `src/sources/markdown.ts` |
| `published` | `blogDir`, `baseUrl` | the published-post index: per post, the stack parts it's **about** (in its title, tags or summary) and the ones it only **mentions** (its body), against the glossary terms | `src/sources/published.ts` |

The published-post index lives in `dataDir/published-index.json`. A post whose content hash and term list haven't changed keeps its stored entry, so each post is read once. `postsAbout(index, term)` returns the published (not draft) posts about a stack part, newest first. That's the link a draft uses instead of explaining the part again (brief D1, D3).

Compass isn't a source yet. The readers return the same `Read<T>` shape (`src/sources/types.ts`), so a Compass reader can be added beside them later.

## Example: Tim's Obsidian layout

This block goes in his instance's settings, not in the code:

```json
"sources": {
  "topics": [
    { "name": "decisions", "kind": "markdown", "root": "/home/ductor-user/.ductor/workspace/Obsidian/ensemble/products",
      "include": ["*/decisions/adr/*.md", "*/decisions/vision-briefs/*.md"] },
    { "name": "experiments", "kind": "markdown", "as": "experiment",
      "root": "/home/ductor-user/.ductor/workspace/Obsidian/ensemble/personal-instances/personal-comms/decisions/experiments",
      "include": ["*.md"] },
    { "name": "github", "kind": "github", "repos": ["tyu41275/ensemble-chatter", "tyu41275/Relay", "tyu41275/chatter-ops"],
      "incidentLabel": "incident", "measuredPattern": "before.{0,200}after|measured", "tokenFile": "/home/ductor-user/.ductor/host-chatter/ghostpen/config/github-token" }
  ],
  "references": [
    { "name": "glossaries", "kind": "glossary", "root": "/home/ductor-user/.ductor/workspace/Obsidian/ensemble/products",
      "include": ["*/docs/CONTEXT.md"] }
  ],
  "published": { "blogDir": "/home/ductor-user/.ductor/host-chatter/ghostpen/checkout/data/blog", "baseUrl": "https://<the blog's address>" }
}
```

The `baseUrl` and the token file are the operator's to fill in.
