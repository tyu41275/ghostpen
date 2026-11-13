# Readiness (ghostpen#117)

`GET /readiness` tells chatter what ghostpen needs and whether it has it, in version 1 of chatter's format (chatter's
`docs/adapter-readiness.md`, fleet ADR 0112). It is on the service's port and, like `/health`, has no key, since chatter
sends none. Code: `src/service/readiness*.ts`.

- **It reads, and does nothing else.** It reads the settings and local files. It calls nothing outside: no GitHub, no
  `gh`, no scorer, no writer. It writes nothing. It never makes this week's shortlist, never reads a source's documents and
  never builds the published-post index, since each of those writes. A folder or file is asked with one call that does not
  block (`fs/promises`), and the list reads `ranking.json` and `shortlist.json` once each.
- **Unknown is not fine.** A need whose check throws reads `failing`, and a need that has not answered in 4 s reads
  `failing`. The list always carries all 13 needs and answers well inside chatter's 5 s.
- **A reason holds no value.** It names a setting (`sources.topics[1].root`), with counts and times. It never quotes a
  path, an address, a token or an error's own words: a file's parse error quotes the file, and a draft's problem holds git's
  output. `line` (`readiness-reading.ts`) takes out any path or address that slips in all the same.
- **Every setting belongs to a need** (`NEED_OF_SETTING`, typed against `GhostpenSettings`, so a new setting does not
  compile until it is named there).
- **Required means the install writes it.** `settings-file`, `data-dir`, `app-identity` and `adapter-key` are required, so
  chatter refuses a switch-on while one is `not_set_up`. Their fix is to run ghostpen's install through Relay. Every other
  need is the operator's to add, and its fix names the block to add to the kept settings and the page that explains it.
- **What spends** is `scorer`, `drafting` and `publishing` (`usage`): a model scores each changed topic, the writer drafts,
  and the review command starts a model review of each pull request. Each is `chosen_off` until its block is set.

`since` is when the service started, unless a file gives a better time (a ranking's `ranAt`, a draft's time, the last
keyed call). A failing reading is `since` now, or since the time it went stale.

## Settings

- `settings-file` reads the file again on each list. The service only picks up a changed file when it restarts, so every
  other need reads the copy it started on. This one is `failing` while the file is missing, is not a plain file, is not
  JSON, fails the settings' checks (naming the setting) or says something other than what the service runs on (fix:
  restart). A service started without a file is `not_set_up`.
- `data-dir` (`dataDir`): `failing` when the folder is missing, is not a folder, or cannot be written.
- `app-identity` (`appIdentityKeyFile`) and `adapter-key` (`adapterKeyFile`): `not_set_up` with no setting. `failing` when
  the file is missing, is not a plain file, holds no key `readAppKey` takes, or holds another key than the one the service
  started with (fix: restart).
- `channel` (`shortlist.channel`, else `instanceFactsFile`): `working` when `shortlist.channel` is set, or chatter's
  instance facts name ghostpen's channel (`adapterChannels.ghostpen.channelId`). `not_set_up` with neither setting.
  `failing` when the facts file is missing, is not JSON, or names no channel for ghostpen yet.
- `scorer` (`scorer`): `chosen_off` with no setting. `failing` when `scorer.command[0]` is not a file that can be run (a
  bare name is looked up on `PATH`), or when the last ranking has scorer failures (counted).

## Sources

- `topic-sources` (`sources.topics`): `not_set_up` when empty. `failing` when a markdown source's root is not a folder that
  reads or a GitHub source's `tokenFile` is not a file that reads (each named by its place in the list), or when the last
  ranking has problems reading these sources (counted, never quoted). GitHub itself is never asked.
- `glossaries` (`sources.references`): `not_set_up` when empty, `failing` when a root is not a folder that reads.
- `published-posts` (`sources.published`): `not_set_up` with no setting, `failing` when `blogDir` is not a folder that reads.

## Jobs

- `ranking` has no schedule: it runs when someone runs `node dist/cli/rank.js <settings>`, and the shortlist only reads the
  `ranking.json` it writes. `not_set_up` with no topics, `chosen_off` with no scorer. With no `ranking.json` yet it is
  `short_of_data`, due 8 days after the service started. A file that is not a ranking ghostpen wrote is `failing`, and so
  is a ranking whose `ranAt` is over 8 days old. Otherwise `working`, since its `ranAt`. The fix names the rank command and
  says nothing schedules it yet.
- `weekly-shortlist` (`shortlist`): chatter's adapter asks the service for the week's shortlist on a 10-minute heartbeat,
  with the adapter key. The service keeps, in memory, when a call with the key last came. `not_set_up` with no `shortlist`
  or no `adapterKeyFile`. With no keyed call since the start it is `short_of_data`, due 20 minutes after the start. A last
  call over 30 minutes old is `failing`. So is a card of this week's shortlist that is not posted 30 minutes after the
  shortlist was made. Otherwise `working`, since the last call.
- `drafting` (`draft`): `chosen_off` with no setting. `failing` when the writer's or the stack map's program cannot be run
  or the style guide is not a file that reads, when a draft stopped because the writer failed, or when a draft has been
  waiting or drafting longer than the writer's time limit for every try (`timeoutSeconds` times `revisions` plus one) plus
  15 minutes. Drafts that are ready, held or failed their checks are `working`: their cards already ask the operator.
- `publishing` (`publish`): `chosen_off` with no setting, `not_set_up` with no `draft`. `failing` when `repoDir` is not a
  folder that can be written holding `.git`, when `git` or `gh` is not found on `PATH`, when the review command's program
  cannot be run, or when a draft's pull request could not be opened or its merge failed (counted, never quoted).
