# The weekly shortlist (ghostpen#89, ADR 0101 brief D13)

Once a week, at the operator's slot, ghostpen proposes 3 to 5 topics in its channel. The slot is a day and time in their time zone (`settings.shortlist`: `day`, `time`, `timeZone`; Monday 09:00 UTC by default). Each proposal says, in plain words: the topic and why it ranked there (its best scores with their quotes), what a reader leaves with, and what it needs explained first. Buttons: **Write**, **Skip** (asks for a one-line reason) and **Not yet**.

- **The service decides** (`src/service/adapter-routes.ts`, behind the adapter key, `settings.adapterKeyFile`; without the key the routes answer 404):
  - `GET /v1/adapter/shortlist` returns this week's shortlist and where it goes.
    - A week is named by its slot's local date (`src/shortlist/schedule.ts`; summer time doesn't move it), so it posts once per week. A week missed while ghostpen was off is never caught up.
    - The items are fixed when the week is first asked for, from the last ranking (`src/shortlist/picks.ts`): the top topics Tim hasn't written or skipped. One he answered Not yet comes back in a later week. A background post that two or more of the picks need explained is ranked in first.
    - The channel is `shortlist.channel`, else the one chatter made for ghostpen (`instanceFactsFile`, chatter's `instance-facts.json`, `adapterChannels.ghostpen`).
  - `POST /v1/adapter/shortlist/posted` keeps where a card went.
  - `POST /v1/adapter/shortlist/answer` takes a press, **from `shortlist.operator` only**. A Skip needs its reason. Every answer is kept as a choice (`dataDir/choices.json`, tuning the ranking's weights), and a Write on a decision post books its post-mortem. A card answered once keeps that answer. A Write starts its draft when `settings.draft` is set (`docs/publishing.md`).
- **The adapter posts and relays** (inside chatter): see `docs/adapter.md`, "Shortlist".
- **State:** `dataDir/shortlist.json`, per week: the items, where each was posted, and the answer.
