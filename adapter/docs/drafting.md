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

The screenshot privacy check joins these with screenshots (ghostpen#90, part 3).
