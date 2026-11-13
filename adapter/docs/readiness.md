# Readiness (ghostpen#117)

`GET /readiness` tells chatter what ghostpen needs and whether it has it, in version 1 of chatter's format (chatter's
`docs/adapter-readiness.md`, fleet ADR 0112). It is on the service's port and, like `/health`, has no key, since chatter
sends none. Code: `src/service/readiness*.ts`.

- **It reads, and does nothing else.** It reads the settings and local files. It calls nothing outside: no GitHub, no
  `gh`, no scorer, no writer. It writes nothing. It never makes this week's shortlist, never reads a source's documents and
  never builds the published-post index, since each of those writes. A folder or file is asked with one call that does not
  block (`fs/promises`), and the list reads `ranking.json` once.
- **Unknown is not fine.** A need whose check throws reads `failing`, and a need that has not answered in 4 s reads
  `failing`. The list always carries all its needs and answers well inside chatter's 5 s.
- **A reason holds no value.** It names a setting (`sources.topics[1].root`), with counts and times. It never quotes a
  path, an address, a token or an error's own words: a file's parse error quotes the file, and a draft's problem holds git's
  output. `line` (`readiness-reading.ts`) takes out any path or address that slips in all the same.
- **Every setting belongs to a need** (`NEED_OF_SETTING`, typed against `GhostpenSettings`, so a new setting does not
  compile until it is named there). Until the job needs come, `shortlist`, `draft` and `publish` are answered for by
  `settings-file`, whose checks are the only ones they get here.
- **Required means the install writes it.** `settings-file`, `data-dir`, `app-identity` and `adapter-key` are required, so
  chatter refuses a switch-on while one is `not_set_up`. Their fix is to run ghostpen's install through Relay. Every other
  need is the operator's to add, and its fix names the block to add to the kept settings and the page that explains it.
- **What spends** is `scorer` (`usage`): a model scores each changed topic. It is `chosen_off` until its block is set.
- **Nine needs so far.** The four job needs (`ranking`, `weekly-shortlist`, `drafting`, `publishing`) come in the next PR
  of ghostpen#117.

`since` is when the service started, unless a file gives a better time (a ranking's `ranAt`). A failing reading is `since`
now.

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

