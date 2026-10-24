# The value ranking (ghostpen#88, ADR 0101 brief D4–D7, D13)

ghostpen ranks possible posts by the value they give a reader. It doesn't use what the reader already knows: that's handled by explaining (brief D1).

- **Candidates** (`src/ranking/candidates.ts`): one per source document, so a rich document never takes two places.
  - A decision document gives a **decision post**. Its parts are its decisions (numbered bold items, and list items under "Decision" or "What we want"), the options it turned down, and what it says happened.
  - An experiment, an incident issue or a measured pull request gives a **post-mortem**.
  - A decision that hasn't played out yet is still a decision post. It's never held back.
- **Scores** (`src/ranking/scores.ts`): 0 to 3 per factor.
  - Decision posts are scored on stakes, carry-over and thought process.
  - Post-mortems are scored on evidence, surprise and completeness.
  - **Every score quotes the source line that earns it, and the quote is checked against the document word for word** (whitespace aside, at least 8 characters). A missing, out-of-range or unmatched score counts as 0, and says why. Whoever proposes scores can't raise a candidate with words the source doesn't hold.
  - The total is weighted. Every weight starts at 1.
- **The ranking** (`src/ranking/rank.ts`): candidates by total.
  - Each candidate carries its **explanation cost**: the stack parts it names (glossary terms) that no published post is about. Cost never lowers a score.
  - The cost orders the **background posts**: each part, by how many of the top 15 candidates it would unlock.
  - It also lists the **post-mortems owed**: a decision post written before its outcome books one, which becomes due once a post-mortem source (experiment, incident, measured PR) names the decision by its file name or ADR number.
- **Tim's choices** (`src/ranking/choices.ts`, `dataDir/choices.json`):
  - Every Write and Skip is kept. A Skip needs its one-line reason.
  - A Write on a decision post books its post-mortem.
  - **Weight suggestions** come from what's written versus skipped: a third of the score gap, at most half a point, within 0.25–3. They're shown with their reason, and apply only through `applyWeights` once the operator agrees.

Still to come in #88: the scorer (who proposes the scores, as a configured command) and the ranking view on the app page.
