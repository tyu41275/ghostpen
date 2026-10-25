# From a Write to the blog (ghostpen#90, ADR 0101 amended 2026-10-25)

Tim approves every post. Nothing merges without his Publish press, and Publish lands a post only after the independent review approves it.

- **Write** (shortlist card): when `settings.draft` is set, the service drafts the topic (`docs/drafting.md`), one draft at a time (`src/publish/jobs.ts`). The item's `draft` state in `dataDir/shortlist.json` says where it is: `queued`, `drafting`, `ready`, `held`, `failed`, `error` or `published`. A restarted service picks up drafts it was in the middle of. With no `settings.draft`, a Write is only kept.
- **The pull request** (`src/publish/github.ts`), for a ready draft when `settings.publish` is set:
  - ghostpen works in its own clone of the blog repo (`publish.repoDir`; nothing else may edit it). Each post gets a branch `ghostpen/<post-name>` from the base.
  - On it go the post file (`postsDir/<post-name>.mdx`, with the blog's frontmatter and `aiGenerated: true` so it carries the AI banner) and its screenshots (`imagesDir/<post-name>/`).
  - ghostpen pushes the branch and opens one pull request. Its body carries the summary, the preview link (`previewUrl`, `{branch}` filled in) and the check report.
  - The operator's review (`reviewCommand`, an argv with `{repo}`, `{pr}`, `{dir}` and `{round}` filled in) starts at once, detached. Its output goes to `dataDir/reviews/pr-<n>-<round>.log`.
  - An edited draft keeps its first branch, and so its pull request, even when its title changes.
  - With no `settings.publish`, a ready draft stays in ghostpen.
- **The draft card** (`src/service/draft-routes.ts`): the shortlist route hands the adapter each item's card text and which buttons it gets. **Publish** comes only on a ready draft with a pull request. **Edit** comes on ready, failed and stopped drafts. Held drafts wait for their background post.
- **Publish** (`POST /v1/adapter/draft/publish`, the operator only, from the newest card: each press names its draft's round):
  - It checks the pull request at once. It merges only when the review's status (`reviewStatus`, default `independent-review`) has passed and no other check is failing or still running.
  - Otherwise it says why in plain words ("the independent review is still running", "these checks failed: build") and changes nothing.
  - A ready post is marked `publishing` and merged in the background. Its card then says `Published`, or goes back to ready saying why the merge failed. A service stopped mid-merge puts it back to ready, and the next Publish checks again.
  - After merging, it brings the clone back to the base, so the published index sees the new post. Point `sources.published.blogDir` at `repoDir/postsDir`.
- **Edit** (`POST /v1/adapter/draft/edit`, the operator only): the operator's changes go to the writer with the last draft. The new draft runs every check again and updates the same pull request, and the review runs again.

Settings (`publish`):

| Field | Meaning | Default |
| --- | --- | --- |
| `repoDir` | ghostpen's own clone of the blog repo (absolute) | required |
| `repo` | the blog repo, `owner/name` | required |
| `base` | the branch posts merge into | `main` |
| `postsDir`, `imagesDir` | folders inside the repo | `data/blog`, `public/static/images/ghostpen` |
| `imagesUrl` | where the blog serves `imagesDir` | `/static/images/ghostpen` |
| `previewUrl` | preview address holding `{branch}` | none |
| `reviewCommand` | the independent review's argv | none: no review starts, so Publish waits |
| `reviewStatus` | the status that review posts | `independent-review` |

`git` and `gh` come from the service's PATH and use its logins. Pushing needs write access to the blog repo.
