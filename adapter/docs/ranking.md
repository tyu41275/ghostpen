# The value ranking (ghostpen#88)

ghostpen ranks possible posts by the value they give a reader. It doesn't use what the reader already knows: that's handled by explaining.

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
- **The operator's choices** (`src/ranking/choices.ts`, `dataDir/choices.json`):
  - Every Write, Skip and Not yet is kept with its reason (every press needs one, `docs/feedback.md`).
  - A Write on a decision post books its post-mortem.
  - **Weight suggestions** come from what's written versus skipped: a third of the score gap, at most half a point, within 0.25–3. They're shown with their reason, and apply only through `applyWeights` once the operator agrees.

- **The scorer** (`src/ranking/scorer.ts`, ghostpen#146): a `ghostpen.scorer` model turn, one per candidate to score. The service queues it and ghostpen's adapter in chatter runs it with `ctx.runCapability` (`docs/adapter.md`, Model turns). **Which model and account it uses is the `ghostpen.scorer` persona's route, in the Obsidian `personas.json` chatter reads (chatter's `docs/persona-routes.md`). Nothing in the code names one.**
  - Settings: `scorer` is `{timeoutSeconds}`, each turn's time, from 10 to 3600 (default 300), at most chatter's 30 minutes used. With no `scorer` nothing is ranked. A `command` from older settings is ignored, never refused: keep it until chatter's adapter is the one that runs turns (an older adapter refuses a scorer without one), then delete it.
  - It gets one prompt: the rubric for the candidate's kind, the plain-words rule, the answer's shape and the numbered document. The turn sends the scorer's instructions version (`SCORER_VERSION` in `src/ranking/scorer.ts`). Change the prompt's fixed words and bump it: `test/instructions-versions.test.ts` pins its hash under its version.
  - It answers one JSON object: `topic`, `takeaway`, and each factor's `{score, quote}`. Its scores are only proposals; the quote check above decides.
  - Results are kept in `dataDir/scores.json` by document hash, so a run scores only documents that changed. Each kept score has `ran`: what its turn ran on (persona, instructions version, provider, model, effort, thinking level; `src/turns/ran.ts`). A version bump rescores nothing: a kept score keeps the `ran` it was made with. A score kept before has no `ran` and stays valid.
  - A candidate whose turn fails (nobody took it, chatter's run failed, a timeout, no JSON) is left out and its failure reported. It never gets made-up scores.
- **A run** (`src/ranking/run.ts`): it reads every source, makes candidates, scores the changed ones and ranks them. It writes `dataDir/ranking.json` with every source problem and scorer failure. With no scorer set, nothing is ranked and the run says so.
- **When it runs** (`src/ranking/jobs.ts`, ghostpen#118): the service ranks on its own. There's no timer. Each keyed ask for the weekly shortlist (chatter's adapter asks every 10 minutes) checks whether a ranking is due, which needs a scorer, at least one topic source, no ranking running, and no failed try in the last hour. Then either this week's shortlist isn't made yet and the ranking is over a day old (or there's none), or the ranking is over 7 days old (or there's none). The 7 days stay under the readiness list's 8, so a ranking that keeps working never reads as stale.
  - A due ranking starts and the ask answers `waiting` at once. The next ask makes the week from the fresh ranking. If this week's try failed, the week is made from the last readable ranking. A week once made is never changed.
  - **No command ranks by hand:** the scorer's turns are chatter's to run, and a command line has no chatter. `node dist/cli/rank.js` only says so and exits 1. The service tries again on its own: no sooner than an hour after a failed try (`RETRY_MS`), and before the next weekly shortlist at the latest.
  - **One at a time:** every try takes `dataDir/ranking.lock` (the taker's pid, a random token and start time). A lock whose process isn't alive, or that is over 12 hours old (its pid may belong to another process by then), is taken over by one contender only: the one that creates `ranking.lock.takeover-<the lock's token>` and then finds the same lock still there; any other skips. A try removes the lock at its end only while the lock is still its own. While a live one holds it (another service on the same data folder), the service keeps its try as skipped with `a ranking is running already`, unless the holder's own record says it is running: that record stays.
  - **The last try** is kept in `dataDir/ranking-attempt.json`: who ran it (`service`, or `hand` in a record the retired rank command wrote), the week, when it started and ended, and its outcome (`running`, `ok`, `failed` with its problem, or `skipped`).
- **The app page** shows the last ranking:
  - each topic with its takeaway, kind and score;
  - each factor's score, opening to the quoted line and where it is (or why it counts for nothing);
  - what needs explaining;
  - the posts to write first, the post-mortems owed, and the problems;
  - a ranking running now, a last try that failed (with its problem) or was skipped, and the ranking's age once it's over 8 days old.

  A ranking file that can't be read says so. It never shows as empty.
