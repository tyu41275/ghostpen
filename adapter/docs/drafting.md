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
- **Diagrams match the stack map** (`src/draft/diagrams.ts`): the stack map is Relay's `relay graph --format json`, the Mermaid flowcharts in `draft.diagramFiles`, or both (`src/draft/diagram-files.ts`).
  - In a Mermaid flowchart, every arrow between two boxes the map knows (matched by label, any case) must be an edge of the map, in either direction.
  - With files set, the map is every source joined by box label (any case): an arrow passes when the stack map or any file draws it.
  - Arrows to boxes the map doesn't know are left alone, so concept diagrams pass.
  - With no map configured, a diagram with boxes can't be checked. The check fails and says so instead of passing it.
  - **It fails closed on a file.** A configured file that is missing or unreadable, isn't a flowchart (`flowchart` or `graph` first) or draws no arrows gives no map at all, even when the stack map reads. So does a stack map that fails beside files. The writer is told to draw no diagram, the draft's problems name the setting (`draft.diagramFiles[1]: it draws no arrows`, never its path), and every diagram with boxes fails as one that can't be checked.
- **Every link leads to a post the blog serves** (`src/draft/links.ts`, ghostpen#108): every link to `/blog/<slug>`, by path or by the blog's own address (`sources.published.baseUrl`), outside code, as `[text](...)`, `<...>` or `href="..."`.
  - The post must be in the sitemap the site serves (`docs/sources.md`). A slug with no post file, a post marked `draft: true`, and a post the site's build left out each fail, named.
  - Other paths (`/tags/...`, `/about`, `/blog/page/2`) and other sites aren't checked. A draft with no post links passes.
  - **It fails closed.** With the sitemap unread, or no `sources.published`, every post link fails as one that can't be checked.

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
  - the arrows touching those parts, from the stack map and the diagram files. It may draw only those. With no map, or a configured source that can't be read, it draws no diagram of the setup.
  - a line that diagrams and screenshots carry the visuals, and a code snippet goes in only where a diagram can't show the idea. This is guidance, not a check: whether a diagram could show it is a judgement.
  - the style guide (`draft.styleGuide`) and the author's recent published posts for the voice (`draft.voicePosts`; never drafts or `aiGenerated` posts);
  - the source documents. A background post gets the part's definition and the (up to 3) documents that name it most.
- **What it answers**: one JSON object with `title`, `summary`, `tags` and `markdown`.
- **Checks and revisions**: every draft runs all the checks above.
  - A failed draft goes back with the failed checks, up to `draft.revisions` times (default 2).
  - A draft **held** for a background post stops at once, because rewording can't write that post.
  - A draft whose post links can't be checked (the sitemap unread) stops at once too, and fails: rewording can't read the sitemap.
  - A failed revision keeps the last draft and says why.
- **Kept** in `dataDir/drafts/<id>-<hash>.json` with its status (`ready`, `held` or `failed`), report, attempts and every problem (an unreadable source, no stack map). Nothing is published from here: Tim approves every post (brief D14).

Settings (`draft`):

| Field | Meaning | Default |
| --- | --- | --- |
| `writer` | `{command, timeoutSeconds}`: the command that writes (argv, no shell). Which model and account is the operator's choice. | required; 900 s |
| `styleGuide` | absolute path of a markdown style guide | none |
| `voicePosts` | recent published posts read for the voice, 0 to 5 | 2 |
| `stackMap` | `{command, timeoutSeconds}` printing `relay.stack.graph/v1` JSON (`relay graph --format json`) | none: diagrams can't be checked; 60 s |
| `diagramFiles` | 1 to 10 different absolute paths of Mermaid flowchart files (`.mmd`), joined with the stack map or used instead of it | none |
| `revisions` | times a failed draft is sent back, 0 to 3 | 2 |
| `screenshots` | `{pages, private, timeoutSeconds}`: each page `{name, url, description, mask?, waitFor?, width?, height?}` (1 to 20 pages; 1280×800 by default); `private` adds regular expressions; timeout 5 to 300 s | none: no screenshots; 30 s |
