# Feedback: reasons, questions and context (ADR 0101, amended 2026-10-25)

ghostpen keeps everything the operator tells it, so a learning loop can grow from it.

- **A reason on every press** (`src/feedback/chips.ts`):
  - Each shortlist card has a pick list of short reasons for Write, Skip and Not yet ("Write: Others would find it useful", "Skip: Already covered", …). One pick answers the card with that reason.
  - Pressing a button instead asks for the reason in chatter's private form: the "Other…" path.
  - A ready draft's card does the same for Publish. Edit's changes count as its reason.
  - The service refuses a press without a reason.
- **A thread on every card** (`src/feedback/thread.ts`, `src/adapter/threads.ts`):
  - Each new shortlist card opens a thread named after its topic (chatter's post `thread` option, ensemble-chatter#5252; an older chatter opens none).
  - A thread the operator opens on a card, or on a draft card, counts the same: on Discord its id is the card's.
  - chatter hands every message to the adapter first. A message in a card's thread is ghostpen's: chatter is told so at once, and the reply follows in the thread.
  - Only the operator's messages are taken.
  - ghostpen asks its answering command (`settings.draft.writer`, else `settings.scorer`) with the plain-words rule first, the topic's source documents, its ranking entry and scores with their quoted lines, and the thread so far. The command answers whether the message is a question, context or both, plus a reply in plain words. It says so when the sources don't hold the answer.
  - Context is kept on the topic and given to the writer as true facts. It never changes a score.
  - The message is kept before the answer is asked for, so a failed answer or no command still keeps it as context, and the reply says so.
- **On the app page**: each topic shows its context, and "What you told ghostpen" lists the latest 50 notes, newest first.
- **Where it goes** (`src/feedback/store.ts`, `dataDir/feedback.json`, oldest first): every reason, with its press and whether it was a pick. Questions, answers and context from a card's thread go here too.
  - Reasons still tune the ranking through `choices.json` (`docs/ranking.md`).
  - Each entry is marked `intake: "pending"`. Once chatter's operator intake exists (ensemble-chatter#4637), ghostpen hands the entries to it, so Reflection learns from them.
