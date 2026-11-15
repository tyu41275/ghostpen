# What ghostpen reads (ghostpen#87, ADR 0101 brief D8)

ghostpen reads only what its settings' `sources` block names. Nothing in the code knows Obsidian or any one person's folders. A source that can't be read (a missing folder, a pattern matching nothing, a link leading out of its folder, a repository GitHub refuses) is reported by name. It's never treated as empty. Every item keeps where it came from: a file and line, or a web address. That way a score can quote the exact line that earns it.

| Block | Kind | What it gives | Code |
|---|---|---|---|
| `topics[]` | `markdown`: `root`, `include` globs (inside root), `as` = `decision` (default) or `experiment` | each file as a topic document: title (first `# ` heading, else the file name) and every line | `src/sources/markdown.ts` |
| `topics[]` | `github`: `repos`, `incidentLabel`, `measuredPattern` (a case-insensitive regular expression), `days` (default 60), optional `tokenFile` | issues carrying the label, and merged PRs whose body matches the pattern, each as a topic document located by its URL | `src/sources/github.ts` |
| `references[]` | `glossary`: `root`, `include` | each `## Term` section: the term, its text up to the next heading, and the heading's line | `src/sources/markdown.ts` |
| `published` | `blogDir`, `baseUrl` | the published-post index: per post, the stack parts it's **about** (in its title, tags or summary) and the ones it only **mentions** (its body), against the glossary terms; and which posts the site serves, from `<baseUrl>/sitemap.xml` | `src/sources/published.ts`, `src/sources/served.ts` |

The published-post index lives in `dataDir/published-index.json`. Each build reads every post to hash it. A post whose hash, the term list and the blog address haven't changed keeps its stored entry, so only changed posts are parsed again. `postsAbout(index, term)` returns the published (not draft) posts about a stack part, newest first. That's the link a draft uses instead of explaining the part again (brief D1, D3).

**What the site serves** (ghostpen#108). A post file the site's build leaves out (an empty `lastmod`, say) answers 404, so it is no post to link. Each read of the sources also reads `<baseUrl>/sitemap.xml` once (10 s, at most 2 MB):
- Only paths are compared: the sitemap's addresses may carry another host (the blog's `siteUrl`). A post is served when `/blog/<file name>` is listed.
- A non-draft post that isn't listed is left out of `postsAbout`, and is named in a `published` problem: "1 post is in the blog folder but the site does not serve it: a.mdx".
- A sitemap that can't be read (no answer, not 200, over 2 MB, or no `/blog/` address in it) is a `published` problem. It's never taken as "nothing is served": every post then counts as served, and a draft's post links can't be checked (`docs/drafting.md`).
- Whether a post is served is never stored in the index file, as it changes without the post changing.
- The readiness list never reads the sitemap: it calls nothing outside.

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
