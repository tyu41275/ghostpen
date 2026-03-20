# Review: AIGeneratedBanner link to EcoOrchestra foundation post

**Project**: ghostpen
**Date**: 2026-03-20
**Branch**: feature/banner-link-26
**Issue**: ghostpen#26
**Files Reviewed**: `components/AIGeneratedBanner.tsx`, `components/Link.tsx`

---

## Critical Issues

### 1. Link uses internal path but issue requires absolute URL with new-tab behavior

The implementation uses `href="/blog/2026-03-15-what-is-ecoorchestra"` — a relative internal path — routed through the project's `CustomLink` component.

The acceptance criteria in issue #26 state:
- Link target: `https://timyu-blog.vercel.app/blog/2026-03-15-what-is-ecoorchestra`
- Link must open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`)

The `CustomLink` component (`components/Link.tsx`) routes any `href` starting with `/` through Next.js `<Link>` as an **internal** link. This means:
1. The link will NOT open in a new tab — the `target="_blank"` requirement is unmet.
2. The link will NOT navigate to the canonical external URL — it navigates within the same Next.js app. If this blog is ever served at a path that doesn't have `/blog/2026-03-15-what-is-ecoorchestra`, it will 404.
3. The `rel="noopener noreferrer"` safety attribute (required by the issue) is never set, because `CustomLink` only applies it to external links.

The fix is to pass the full absolute URL (`https://timyu-blog.vercel.app/blog/2026-03-15-what-is-ecoorchestra`), which `CustomLink` will correctly detect as an external link and render as `<a target="_blank" rel="noopener noreferrer">`. No changes to `CustomLink` are needed — only the `href` value in `AIGeneratedBanner.tsx` must be corrected.

---

## Separation of Concerns Violations

None. The change is correctly scoped to a single component file. Using the project's own `CustomLink` wrapper (imported as `Link` from `./Link`) rather than a raw `<a>` tag is the right pattern for this codebase.

---

## Warnings

### W1. Pre-existing: Husky pre-commit hook missing shebang line

`C:/Repos/ghostpen/.husky/pre-commit` contains only:
```
npx --no-install lint-staged
```
There is no `#!/usr/bin/env sh` or `#!/bin/sh` shebang line. This is a pre-existing issue, not introduced by this change. On most Linux/macOS environments husky v8+ injects its own wrapper and this works, but on environments where the shell is not inferred (some CI runners, custom git setups) the hook may silently fail or be skipped rather than blocking commits. The risk is that lint-staged does not run.

**This change did not introduce this problem** and it is not a blocker for this PR, but it should be tracked.

---

## Suggestions

### S1. Consider whether internal routing is ever intentional for this link

If the blog is always deployed at the same domain and the target post will always live at that path on the same site, using an internal link (`/blog/...`) would be acceptable behavior — just not what the issue specifies. The reviewer has no context to override the issue's explicit `target="_blank"` requirement, so this is flagged as a critical issue rather than a suggestion. But the developer should confirm with the product owner whether the same-tab/same-domain behavior was intentional before implementing the fix.

---

## Good Patterns

- Correctly imports the project's `CustomLink` wrapper (`import Link from './Link'`) rather than reaching for a raw `<a>` tag or importing `next/link` directly. This ensures external link handling (rel, target) is consistent with the rest of the codebase — the only problem is the wrong `href` value prevented that logic from triggering.
- Dark mode Tailwind classes (`dark:decoration-gray-500 dark:hover:text-gray-300`) are present and consistent with the banner's existing dark-mode color palette.
- The link styling (`underline decoration-gray-400 underline-offset-2`) is visually subtle — appropriate for a disclosure banner where the link is supplementary context, not a CTA.
- The `{' '}` whitespace nodes before and after the link preserve correct text spacing around the inline element.
- The banner's `role="note"` accessibility semantics are unaffected by the change.
