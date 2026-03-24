# Review: feat: ghostpen should scan research/ files as blog content source (#854) — fix loop

**Project**: ghostpen
**Date**: 2026-03-24
**Files Reviewed**: ghostpen/scripts/generate_post.py

## Critical Issues
None.

### Dependency Direction Violations
No dependency direction violations.

## Separation of Concerns Violations
None.

## Warnings

### Brittle Slug Parsing in `build_foundation_registry()`
In `build_foundation_registry()` (line 81), the slug is derived with:
```python
slug = "-".join(name.split("-")[3:])
```
This hardcodes the assumption that all blog post filenames follow `YYYY-MM-DD-slug` format. A non-dated filename (e.g., `what-is-ghostpen.mdx`) produces an incorrect slug. Tracked as https://github.com/tyu41275/ghostpen/issues/59.

## Suggestions

### Refactor Repetitive File Reading Logic
The `gather_artifacts` function contains several similar `try...except OSError` blocks. A `_read_file_safely(path: Path) -> str | None` helper would reduce duplication.

### Improve Standup Keyword Matching
The broad substring check in `gather_artifacts` (line 157) could produce false positives. Tighter regex or word-boundary matching would improve artifact quality.

## Good Patterns

- **Input sanitization**: Feature slug validated against strict regex; `sanitize_title_for_cli()` guards all subprocess calls.
- **Error handling**: `generate_post()` covers `ConnectionError`, `HTTPError`, and `Timeout` with user-friendly messages.
- **Graceful fallbacks**: Title and summary derivation fall back cleanly when vision briefs or research docs are absent.
- **Configuration management**: All env vars with defaults at the top of the file — clean and overridable.
- **`LLM_ROUTER_URL` fix**: Correctly defined as `os.environ.get("LLM_ROUTER_URL", "http://localhost:8321")` alongside other API constants.
