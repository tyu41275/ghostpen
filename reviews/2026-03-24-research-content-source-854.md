# Review: feat: ghostpen should scan research/ files as blog content source (#854)

**Project**: ghostpen + EcoOrchestra
**Date**: 2026-03-24
**Files Reviewed**: ghostpen/scripts/generate_post.py, eco_orchestra/blog_scorer.py

## Critical Issues

### 1. `NameError: LLM_ROUTER_URL` is undefined in `generate_post()`

In `ghostpen/scripts/generate_post.py`, `generate_post()` references `LLM_ROUTER_URL` at lines 243 and 254:

```python
url = f"{LLM_ROUTER_URL}/route"
...
print(f"Error: Cannot connect to Anthropic API at {LLM_ROUTER_URL}")
```

`LLM_ROUTER_URL` is not defined anywhere in the module — not as a constant, not as an import, not as a parameter. The script will crash with `NameError: name 'LLM_ROUTER_URL' is not defined` whenever `generate_post()` is called. This constant was likely intended to be defined alongside the existing constants (`ANTHROPIC_API_KEY`, `ANTHROPIC_API_URL`).

**Fix**: Add `LLM_ROUTER_URL = os.environ.get("LLM_ROUTER_URL", "http://localhost:8321")` to the Configuration section at the top of the file.

### Dependency Direction Violations
No dependency direction violations.

## Separation of Concerns Violations
None.

## Warnings

### 1. Redundant research directory scan in `main()`

`main()` performs a research directory glob to check for standalone docs when no vision brief is found, then `gather_artifacts()` performs the same glob again to read file contents. The first scan result (a list of `Path` objects) could be passed to `gather_artifacts()` to avoid the second iteration. Not a correctness issue — just mild inefficiency for large research directories.

## Suggestions
None.

## Good Patterns

1. **Clean standalone research trigger** — The logic in `main()` to allow research docs to trigger blog generation without a vision brief is well-structured. The early exit is preserved, and `feature_info` is constructed with a `None` brief_path so downstream logic isn't broken.

2. **Testable `blog_scorer.py` changes** — `_count_research_docs()` as a standalone helper with an injectable `research_dir` parameter makes it straightforward to test. Consistent with all other signal helpers in the file.

3. **Consistent error handling in `gather_artifacts()`** — Research doc scanning follows the same `try...except OSError` / existence-check pattern as reviews and standups. No new failure modes introduced.
