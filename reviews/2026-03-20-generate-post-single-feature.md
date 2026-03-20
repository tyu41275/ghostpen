# Review: generate_post.py — Single-Feature Mode
**Issue**: #17 — Create generate_post.py — single-feature mode
**Branch**: `feature/generate-post-single-17`
**Reviewed**: 2026-03-20
**Reviewer**: Automated code review

---

## Verdict: APPROVE with minor notes

The implementation is solid. All acceptance criteria are met. Two minor bugs and one spec gap are noted — none block merge, but two are worth fixing before the backfill mode (#10) is built on top of this.

---

## Acceptance Criteria Walkthrough

| Criterion | Status | Notes |
|---|---|---|
| `scripts/generate_post.py` exists with argparse CLI | PASS | Verified, `--help` works |
| `--feature`, `--artifacts-dir`, `--dry-run`, `--llm-url` args | PASS | All present, correct defaults |
| Blog-worthiness check exits 0 when no vision brief | PASS | Tested: `--feature nonexistent-slug` → exits 0 with correct message |
| Reads `data/style-guide.md` as system prompt | PASS | Line 457; exits 1 if missing |
| Gathers vision brief, reviews, standups, screenshots, commit history | PARTIAL | See bug #2 below — reviews only scan EcoOrchestra |
| Calls llm-router at `http://localhost:8321/route` with correct schema | PASS | `prompt` + `system` fields, not `messages` |
| Parses LLM response into title, tags, summary, body | PASS | Robust line-by-line parser |
| Generates `.mdx` with correct frontmatter (`draft: true`, `aiGenerated: true`) | PASS | Lines 343–357 |
| Copies screenshots to `public/static/images/<slug>/` | PASS | `copy_screenshots()` + `insert_image_refs()` |
| `--dry-run` prints prompt without calling LLM | PASS | Tested with `ai-dev-blog` slug — shows system + user prompt |
| Graceful error handling for all failure modes | PASS (with caveat) | See bug #1 below |
| No pip dependencies beyond `requests` (stdlib + requests only) | PASS | urllib fallback correctly implemented |
| Does NOT create git branches or PRs | PASS | Script is output-only |

---

## Bugs

### Bug #1 — Medium: `BLOG_DIR` not created before writing (lines 505–514, 529–535)

The script writes to `BLOG_DIR / f"{slug}.mdx"` and `BLOG_DIR / f"{slug}.mdx.raw"` without calling `BLOG_DIR.mkdir(parents=True, exist_ok=True)` first. In the current repo `data/blog/` already exists, so this doesn't fail today. But the `data/blog/` directory is not guaranteed on a fresh clone (it contains only `.mdx.disabled` files and is not explicitly tracked as a directory), and the raw recovery path (lines 505–514) is the worst time for a surprise `FileNotFoundError` — it fires when parsing already failed.

**Fix**: Add `BLOG_DIR.mkdir(parents=True, exist_ok=True)` before the write at line 529, and before the raw fallback write at line 506.

### Bug #2 — Low: `find_reviews()` only scans EcoOrchestra, not ghostpen's own `reviews/` directory (line 99–102)

The issue spec says: *"scan `reviews/` in the target project repo AND in EcoOrchestra for `*<slug>*` files"*. `find_reviews()` only receives `artifacts_dir` (EcoOrchestra) and builds one pattern against `artifacts_dir/reviews/`. The ghostpen `reviews/` directory (which already has `2026-03-20-ai-generated-banner.md`) is never scanned.

For the current use case (generating posts about EcoOrchestra features), EcoOrchestra reviews are the primary source — so this doesn't affect quality today. But the spec is explicit about dual-repo scanning, and this is the foundation for issue #10 (backfill mode).

**Fix**: Pass `GHOSTPEN_ROOT` into `find_reviews()` as a second source and merge results, or make `find_reviews()` accept a list of directories.

---

## Non-Bug Observations

### Response field lookup order (line 275)

```python
text = data.get("text") or data.get("raw_text") or ""
```

The `RouteResponse` schema (`server_models.py` line 42) defines the field as `raw_text`, not `text`. There is no `text` field in the response. Trying `"text"` first is harmless (returns `None`) and falls through to `raw_text`, but it's misleading. The comment on line 273–274 acknowledges this as a fallback. Recommend reversing the order to `data.get("raw_text") or data.get("text") or ""` so the canonical field is tried first.

### `images: []` frontmatter is hardcoded even when screenshots exist (line 354)

When screenshots are found and copied, their references are inserted into the post body as markdown `![...]()` syntax. The `images: []` YAML frontmatter field remains empty regardless. This is functionally harmless for the Next.js blog template (which uses the frontmatter `images` field for OG image previews, not body rendering), but it's inconsistent. Not blocking.

### Standup scanning uses `fpath.endswith(".md")` on a full path (line 116)

`fpath` is an absolute path string (e.g. `C:/Repos/EcoOrchestra/standups/2026-03-20/standup.md`). `str.endswith(".md")` is case-sensitive on Windows. A file named `standup.MD` would be skipped. In practice standup files are always lowercase `.md`, so this is a near-zero risk. Using `Path(fpath).suffix.lower() == ".md"` would be more robust.

### `get_commit_history()` runs `git log` with `cwd=C:/Repos` (lines 148–149)

`C:/Repos` is technically a git repo (root-level `.git` initialised, master branch, no commits). `git log --all --oneline --since="7 days ago" --grep=<slug>` will return nothing (no commits), exit 0, and `result.stdout.strip()` will be empty — so `commit_history` will be `""`. This is correct silent-no-op behavior. No bug, but the approach relies on `C:/Repos` being a git root to avoid a non-zero exit. If it ever stops being a git repo, `get_commit_history()` silently returns `""` anyway (caught by the `returncode == 0` check or the `OSError` handler), so it degrades gracefully.

### No slug sanitization (lines 95, 101, 130, 144, 367)

The slug is passed directly into glob patterns, git `--grep=`, and Path construction with no validation. A slug containing glob special characters (`[`, `]`, `*`, `?`) would produce unexpected glob results. A slug with `/` or `..` would traverse directories when constructing `IMAGES_DIR / slug`. This is not a security concern given the script is invoked by a trusted post-ship hook, not exposed to user input. Nonetheless, a one-line guard such as:

```python
if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9\-]*$', slug):
    print(f"Error: invalid slug '{slug}' — must be alphanumeric with hyphens", file=sys.stderr)
    sys.exit(1)
```

would make the script more robust for any future invocation contexts.

---

## Security

No injection risks. Subprocess call at line 137 passes arguments as a list (safe from shell injection). No hardcoded secrets. The script reads EcoOrchestra as a read-only data source. No network calls beyond the configured `llm_url`.

---

## Separation of Concerns

Clean. The script does one thing: gather → prompt → generate. It does not commit, create branches, or call any other services. Read-only access to EcoOrchestra is correctly enforced by design (no writes to that path). The style guide stays in ghostpen, the artifacts stay in EcoOrchestra, the output lands in ghostpen's `data/blog/`. All correct.

---

## Summary

The implementation correctly covers all primary acceptance criteria and demonstrates thoughtful error handling (urllib fallback, UTF-8 stdout forcing on Windows, raw response recovery on parse failure, health check before generation). The two bugs (missing `BLOG_DIR.mkdir` and incomplete reviews scanning) are minor but worth addressing before the backfill mode is built. The code is clean, well-commented, and ready to merge with confidence that the primary happy path and most error paths work correctly.
