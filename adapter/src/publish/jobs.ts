/**
 * Drafting after a Write or an Edit (ghostpen#90), one draft at a time in the service. Each job reads the shortlist
 * state fresh before every change, so a press answered meanwhile is never overwritten. A ready draft becomes a pull
 * request (when `settings.publish` is set) and its review starts; every outcome, a failure included, is kept on the
 * item for the adapter to post. A service restart picks up drafts it was in the middle of.
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { reportText } from "../draft/checks.js";
import { draftNow, readDraft } from "../draft/write.js";
import type { GhostpenSettings } from "../settings.js";
import { findItem, readShortlists, saveShortlists, type DraftState, type WeekItem } from "../shortlist/state.js";
import { openPostPr, startReview } from "./github.js";

export interface JobDeps { draft: typeof draftNow; open: typeof openPostPr; review: typeof startReview; now: () => Date }
const DEFAULTS: JobDeps = { draft: draftNow, open: openPostPr, review: startReview, now: () => new Date() };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300);

export class DraftJobs {
  private chain: Promise<void> = Promise.resolve();
  private readonly deps: JobDeps;
  constructor(private readonly settings: GhostpenSettings, deps: Partial<JobDeps> = {}) { this.deps = { ...DEFAULTS, ...deps }; }

  /** Queues the item's draft (its state already says `queued`). */
  enqueue(week: string, index: number): void {
    this.chain = this.chain.then(() => this.run(week, index)).catch(() => { /* every failure is kept on the item */ });
  }

  /** Queues every draft a stopped service left queued or in the middle. */
  resume(): number {
    let count = 0;
    for (const [week, { items }] of Object.entries(readShortlists(this.settings.dataDir).weeks)) {
      items.forEach((item, index) => { if (item.draft?.status === "queued" || item.draft?.status === "drafting") { this.enqueue(week, index); count += 1; } });
    }
    // A merge cut off by a stop is not known to have happened: the draft goes back to ready, and Publish checks again.
    const state = readShortlists(this.settings.dataDir);
    let cut = false;
    for (const { items } of Object.values(state.weeks)) for (const item of items) {
      if (item.draft?.status === "publishing") { item.draft.status = "ready"; item.draft.problem = "ghostpen stopped while publishing; press Publish again"; cut = true; }
    }
    if (cut) saveShortlists(this.settings.dataDir, state);
    return count;
  }

  /** Resolves when every queued draft is done (tests, shutdown). */
  idle(): Promise<void> { return this.chain; }

  private update(week: string, index: number, change: (draft: DraftState, item: WeekItem) => void): WeekItem | null {
    const state = readShortlists(this.settings.dataDir);
    const item = findItem(state, week, index);
    if (!item?.draft) return null;
    change(item.draft, item);
    item.draft.at = this.deps.now().toISOString();
    saveShortlists(this.settings.dataDir, state);
    return item;
  }

  private async run(week: string, index: number): Promise<void> {
    let notes: string | undefined;
    const item = this.update(week, index, (d) => { d.status = "drafting"; notes = d.notes; });
    if (!item) return;
    const previous = notes ? readDraft(this.settings.dataDir, item.id) : null;
    let draft;
    try {
      draft = await this.deps.draft(this.settings, item.id, {}, previous && notes ? { previous, notes } : undefined);
    } catch (error) {
      this.update(week, index, (d) => { d.status = "error"; d.problem = `the draft could not be written: ${message(error)}`; });
      return;
    }
    const report = reportText(draft.report);
    const publish = this.settings.publish;
    if (draft.status !== "ready" || !publish) {
      this.update(week, index, (d) => { d.status = draft.status; d.title = draft.title; d.report = report; delete d.notes; delete d.problem; });
      return;
    }
    try {
      const pr = await this.deps.open(publish, draft, this.deps.now().toISOString().slice(0, 10), undefined, item.draft?.pr?.branch);
      const logs = join(this.settings.dataDir, "reviews");
      mkdirSync(logs, { recursive: true });
      this.deps.review(publish, pr.number, item.draft!.round, join(logs, `pr-${pr.number}-${item.draft!.round}.log`));
      this.update(week, index, (d) => { d.status = "ready"; d.title = draft.title; d.report = report; d.pr = pr; delete d.notes; delete d.problem; });
    } catch (error) {
      this.update(week, index, (d) => { d.status = "error"; d.title = draft.title; d.report = report; d.problem = `the pull request could not be opened: ${message(error)}`; });
    }
  }
}
