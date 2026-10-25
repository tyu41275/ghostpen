# Draft checks (ghostpen#90, ADR 0101 brief D1–D3, D10, D14)

Every draft must pass these checks before Tim sees it. Each check can fail a draft by itself. They are rules anyone can rerun, not a model's opinion. The report (`reportText`) says in plain words which check failed and why.

- **Plain words** (`src/draft/plain.ts`): everything ghostpen writes must be explainable to a 10-year-old.
  - The reading grade (Flesch-Kincaid) of the prose must be 8 or lower.
  - No sentence may be longer than 30 words. The report quotes the three longest.
  - Code, diagrams, link addresses, headings and tables are not prose, so they aren't counted.
- **Every stack part linked or explained** (`src/draft/stack-parts.ts`): a stack part is a glossary term, such as a product, an app or a tool in the author's setup.
  - **A part with a published post** must link that post (its full address or its path). The check uses the newest post that is about the part.
  - **A central part with no post** holds the draft. A part is central if it's in the title or named three times or more. Its background post gets written first.
  - **A part only mentioned in passing** must be explained right where it first appears. The rule: within about 12 words, there must be an explaining phrase (" is ", " are ", " (", a dash, ", a ", ", the ", ", which ", ": a "). The part then goes on the "posts to write later" list.
- **Diagrams match the stack map** (`src/draft/diagrams.ts`): the stack map is Relay's `relay graph --format json`.
  - In a Mermaid flowchart, every arrow between two boxes the map knows (matched by label, any case) must be an edge of the map, in either direction.
  - Arrows to boxes the map doesn't know are left alone, so concept diagrams pass.
  - With no map configured, a diagram with boxes can't be checked. The check fails and says so instead of passing it.

- **Screenshots show nothing private** (`src/draft/screenshots.ts`): runs once the words pass, only when the draft asks for a screenshot.
  - The writer may place `![what it shows](screenshot:<name>)` only for a page in `draft.screenshots.pages`.
  - Each page is opened in Chromium (Playwright). Its `mask` selectors are painted over with a solid grey box, not blurred, because a blur can sometimes be undone.
  - Every piece of text the page draws is read from Chrome's own layout snapshot, including text inside web components (open or closed shadow roots) and field values. Text wholly inside a masked area, or styled to draw nothing, is left out. It is checked for private details: email addresses, IP addresses, long id numbers, keys and tokens, home folder paths, and the operator's own `private` patterns. The report names the kind of detail, never the detail itself.
  - **It fails closed.** No picture is kept (none at all, if any one screenshot fails), and the draft fails, if any of these is true:
    - the page doesn't load;
    - it shows content whose text can't be read (a canvas, a video, a frame) outside the masks;
    - its text matches a private pattern;
    - the page isn't configured;
    - the screenshot has no words saying what it shows.
  - What it can't see: text inside pictures (images, icons). Mask those, or don't configure the page.
  - Pictures are kept next to the draft, in `drafts/<id>-<hash>-shots/<name>.png`.

## Writing a draft (`src/draft/write.ts`, `node dist/cli/draft.js <settings.json> <id>`)

The `id` is a shortlist item's: a candidate id, or `background:<part>` for a background post.

- **What the writer gets** (`src/draft/prompt.ts`), the plain-words rule first:
  - the kind of post. A decision post whose outcome isn't known yet says so; a follow-up post-mortem tells how it went.
  - the topic and takeaway from the last ranking, when the candidate is ranked;
  - every stack part the sources name, each with the post to link or its glossary definition to explain it from;
  - the stack map's arrows touching those parts. It may draw only those. With no map, it draws no diagram of the setup.
  - the style guide (`draft.styleGuide`) and the author's recent published posts for the voice (`draft.voicePosts`; never drafts or `aiGenerated` posts);
  - the source documents. A background post gets the part's definition and the (up to 3) documents that name it most.
- **What it answers**: one JSON object with `title`, `summary`, `tags` and `markdown`.
- **Checks and revisions**: every draft runs all the checks above.
  - A failed draft goes back with the failed checks, up to `draft.revisions` times (default 2).
  - A draft **held** for a background post stops at once, because rewording can't write that post.
  - A failed revision keeps the last draft and says why.
- **Kept** in `dataDir/drafts/<id>-<hash>.json` with its status (`ready`, `held` or `failed`), report, attempts and every problem (an unreadable source, no stack map). Nothing is published from here: Tim approves every post (brief D14).

Settings (`draft`):

| Field | Meaning | Default |
| --- | --- | --- |
| `writer` | `{command, timeoutSeconds}`: the command that writes (argv, no shell). Which model and account is the operator's choice. | required; 900 s |
| `styleGuide` | absolute path of a markdown style guide | none |
| `voicePosts` | recent published posts read for the voice, 0 to 5 | 2 |
| `stackMap` | `{command, timeoutSeconds}` printing `relay.stack.graph/v1` JSON (`relay graph --format json`) | none: diagrams can't be checked; 60 s |
| `revisions` | times a failed draft is sent back, 0 to 3 | 2 |
| `screenshots` | `{pages, private, timeoutSeconds}`: each page `{name, url, description, mask?, waitFor?, width?, height?}` (1 to 20 pages; 1280×800 by default); `private` adds regular expressions; timeout 5 to 300 s | none: no screenshots; 30 s |
