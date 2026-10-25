# Feedback: reasons, questions and context (ADR 0101, amended 2026-10-25)

ghostpen keeps everything the operator tells it, so a learning loop can grow from it.

- **A reason on every press** (`src/feedback/chips.ts`):
  - Each shortlist card has a pick list of short reasons for Write, Skip and Not yet ("Write: Others would find it useful", "Skip: Already covered", …). One pick answers the card with that reason.
  - Pressing a button instead asks for the reason in chatter's private form: the "Other…" path.
  - A ready draft's card does the same for Publish. Edit's changes count as its reason.
  - The service refuses a press without a reason.
- **Where it goes** (`src/feedback/store.ts`, `dataDir/feedback.json`, oldest first): every reason, with its press and whether it was a pick. Questions, answers and context from a card's thread go here too (the thread part is ghostpen's next change).
  - Reasons still tune the ranking through `choices.json` (`docs/ranking.md`).
  - Each entry is marked `intake: "pending"`. Once chatter's operator intake exists (ensemble-chatter#4637), ghostpen hands the entries to it, so Reflection learns from them.
