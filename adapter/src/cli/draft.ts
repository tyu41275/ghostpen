/**
 * `node dist/cli/draft.js`: drafts no longer run here. The writer is a model turn chatter runs for ghostpen's service
 * (ghostpen#146), and a command-line process has no chatter, so a draft is made in the service: Write on a shortlist card,
 * or Edit on a draft's card. This says so and exits 1.
 */
console.error("ghostpen draft: drafts are written in ghostpen's service, which asks chatter to run the writer, so this command "
  + "cannot write one. Press Write on the topic's card in ghostpen's channel, or Edit on a draft's card; the draft comes back there.");
process.exit(1);
export {};
