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
  - Each candidate carries its **explanation cost**: the stack parts (glossary terms) central to its document that no published post is about. A part is central where the draft check calls it central (`docs/drafting.md`): in the document's title, or named three times or more as a whole word. One passing mention of a word that is also a term is no cost (ghostpen#111). Cost never lowers a score.
  - The cost orders the **background posts**: each part, by how many of the top 15 candidates it would unlock. Each carries its references: where every glossary defines the part (`path:line`, first sentence) and, per unlocked candidate, the first line that names it, quoted.
  - A term two glossaries define differently (same heading, different text) counts for no candidate and gets no background post; the run reports it under problems until one definition wins. The same text under two headings is one definition.
  - It also lists the **post-mortems owed**: a decision post written before its outcome books one, which becomes due once a post-mortem source (experiment, incident, measured PR) names the decision by its file name or ADR number.
- **Tim's choices** (`src/ranking/choices.ts`, `dataDir/choices.json`):
  - Every Write, Skip and Not yet is kept with its reason (every press needs one, `docs/feedback.md`).
  - A Write on a decision post books its post-mortem.
  - **Weight suggestions** come from what's written versus skipped: a third of the score gap, at most half a point, within 0.25–3. They're shown with their reason, and apply only through `applyWeights` once the operator agrees.

- **The scorer** (`src/ranking/scorer.ts`): the command in `settings.scorer.command`, an argv run without a shell, with `timeoutSeconds` from 10 to 3600 (default 300). **Which model and account it uses is the operator's choice. Nothing in the code names one.**
  - It gets one prompt on stdin: the rubric for the candidate's kind, the plain-words rule, the answer's shape and the numbered document.
  - It answers one JSON object: `topic`, `takeaway`, and each factor's `{score, quote}`. Its scores are only proposals; the quote check above decides.
  - Results are kept in `dataDir/scores.json` by document hash, so a run scores only documents that changed.
  - A candidate the scorer fails on (an exit, a timeout, no JSON) is left out and its failure reported. It never gets made-up scores.
  - A scorer that times out is stopped with everything it started: it runs in its own process group, which gets SIGTERM and then, after 2 s, SIGKILL.
- **A run** (`src/ranking/run.ts`): it reads every source, makes candidates, scores the changed ones and ranks them. It writes `dataDir/ranking.json` with every source problem and scorer failure. With no scorer set, nothing is ranked and the run says so.
- **When it runs** (`src/ranking/jobs.ts`, ghostpen#118): the service ranks on its own. There's no timer. Each keyed ask for the weekly shortlist (chatter's adapter asks every 10 minutes) checks whether a ranking is due, which needs a scorer, at least one topic source, no ranking running, and no failed try in the last hour. Then either this week's shortlist isn't made yet and the ranking is over a day old (or there's none), or the ranking is over 7 days old (or there's none). The 7 days stay under the readiness list's 8, so a ranking that keeps working never reads as stale.
  - A due ranking starts and the ask answers `waiting` at once. The next ask makes the week from the fresh ranking. If this week's try failed, the week is made from the last readable ranking. A week once made is never changed.
  - **By hand:** `node dist/cli/rank.js <settings.json>`.
  - **One at a time:** the service and the rank command both take `dataDir/ranking.lock` (the taker's pid and start time). A lock whose process isn't alive, or that is over 12 hours old (its pid may belong to another process by then), is taken over. While a live one holds it, the rank command exits 1 saying `a ranking is running already`, and the service keeps its try as skipped, unless the holder's own record says it is running: that record stays.
  - **The last try** is kept in `dataDir/ranking-attempt.json`: who ran it (`service` or `hand`), the week, when it started and ended, and its outcome (`running`, `ok`, `failed` with its problem, or `skipped`).
- **The app page** shows the last ranking:
  - each topic with its takeaway, kind and score;
  - each factor's score, opening to the quoted line and where it is (or why it counts for nothing);
  - what needs explaining;
  - the posts to write first, the post-mortems owed, and the problems;
  - a ranking running now, a last try that failed (with its problem) or was skipped, and the ranking's age once it's over 8 days old.

  A ranking file that can't be read says so. It never shows as empty.
