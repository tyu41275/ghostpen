# Review: fix/ai-generated-frontmatter-53 — aiGenerated frontmatter fix

**Project**: ghostpen
**Date**: 2026-03-24
**Files Reviewed**: data/blog/2026-03-24-the-500-line-rule.mdx

## Critical Issues

### Process Violation: AI-generated post is not a draft

The fix correctly adds `aiGenerated: true`, but the file's frontmatter has `draft: false`.

Per the project conventions for AI-generated posts, the post **MUST** be set to `draft: true` to ensure it undergoes human review before publishing. Bypassing this required review step for AI content is a high-risk process violation.

**File**: `data/blog/2026-03-24-the-500-line-rule.mdx`, line 7 (`draft: false`)
**Required fix**: Change `draft: false` to `draft: true`

## Dependency Direction Violations

None.

## Separation of Concerns Violations

None. This is a content-only metadata fix.

## Warnings

None.

## Suggestions

None.

## Good Patterns

Adding the `aiGenerated: true` flag is the correct fix and aligns with the project's goal of being transparent about which content is AI-generated. This is an important convention to enforce.
