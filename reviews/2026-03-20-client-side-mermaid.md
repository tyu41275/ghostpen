# Code Review: ghostpen#37 — Switch to Client-Side Mermaid Rendering

**Branch:** feature/client-side-mermaid-37
**Date:** 2026-03-20
**Reviewer:** Reviewer Agent

---

## Summary

This PR replaces the build-time `rehype-mermaid` plugin (which required Playwright/Chromium on Vercel) with a client-side `mermaid` npm package rendered via a React component. The fix correctly addresses the root cause of the Vercel deployment failure.

**Verdict: APPROVED — no critical issues.**

---

## Checklist Results

### rehype-mermaid fully removed from contentlayer.config.ts

PASS. Both the import (`import rehypeMermaid from 'rehype-mermaid'`) and the plugin entry (`[rehypeMermaid, { strategy: 'img-svg' }]`) have been removed. No remaining mermaid references exist in contentlayer.config.ts.

### Mermaid.tsx component correctness

PASS with one note.

- `'use client'` directive is present at the top — SSR is correctly handled.
- `useEffect` with `[chart, resolvedTheme]` dependencies is correct; re-renders when theme changes.
- `mermaid.initialize()` is called before every `mermaid.render()` call. This works but is slightly redundant — initialize only needs to be called once per theme change. Not a bug, but a minor performance note.
- `mermaid.render()` is called with a random `id` on every render. This is the correct API usage for mermaid v10+.
- Dark mode is handled via `useTheme` / `resolvedTheme` with `'dark'` vs `'default'` theme tokens — correct.
- Error handling: catches render errors and falls back to a styled `<pre><code>` block — good defensive behavior.
- Loading state: renders a neutral placeholder while SVG is being computed — prevents layout shift from nothing.
- `dangerouslySetInnerHTML` is used to inject the SVG output from `mermaid.render()`. See Security section below.
- The `ref` is attached to the container div but is not actually used in the component body (it was presumably needed for a DOM-mutation approach, then abandoned when the state-based approach was used). This is harmless dead code but should be cleaned up.

### MDXComponents.tsx pre override

PASS.

- `MermaidPre` correctly intercepts `<pre>` elements.
- The `language-mermaid` class check is robust: it verifies `children` is an object with `props`, checks `className` is a string, and uses `.includes('language-mermaid')` — handles rehype-prism-plus class naming correctly.
- Falls back to the original `<Pre>` component from pliny for all other code blocks — no regression for non-mermaid fences.
- `chart` extraction handles both `string` and non-string children with a `String()` coercion fallback — reasonable defensive code.

### Build success

Developer confirmed `yarn build` passes 42/42 pages. Not independently verified in this review (read-only), but the code changes are structurally sound and no build-breaking patterns are present.

### SSR correctness

PASS. The `'use client'` directive on `Mermaid.tsx` is correct. The mermaid package is browser-only and would crash on the server if imported in a server component. Next.js 14 will not render this component on the server. No dynamic import is needed since `'use client'` is already sufficient.

---

## Security Assessment

**Finding (Low): `dangerouslySetInnerHTML` with mermaid SVG output**

The component renders `mermaid.render()` output via `dangerouslySetInnerHTML`. The SVG comes from the mermaid library, not from raw user input. In this blog context, diagram source is authored content checked into the repository — not user-submitted. This is an acceptable risk profile for a static blog.

If this blog ever accepts user-contributed content (e.g., guest posts submitted via a CMS without editorial review), the SVG output from mermaid should be sanitized with DOMPurify before injection. Flag this if the content model changes.

**No XSS risk in current context.** Mermaid's own output is trusted; the attack surface only opens if untrusted diagram text can reach the component.

---

## Minor Issues (Non-blocking)

1. **Dead `ref`** — `const ref = useRef<HTMLDivElement>(null)` is declared and assigned to the container div but never read. Safe to remove in a follow-up.
2. **`mermaid.initialize()` on every render** — Calling `initialize` inside the render effect means it re-initializes on every chart/theme change. This is harmless but slightly wasteful. Consider separating the initialize call into its own `useEffect([resolvedTheme])` and the render into `useEffect([chart, resolvedTheme])`, or checking if the theme has actually changed before re-initializing.
3. **ListLayout.tsx / ListLayoutWithTags.tsx** — Reformatting of `tags.map()` JSX is included in this PR. These are cosmetic-only changes unrelated to the mermaid fix. They don't introduce bugs but slightly widen the diff scope.

---

## Files Changed

| File                             | Change                                                | Status               |
| -------------------------------- | ----------------------------------------------------- | -------------------- |
| `contentlayer.config.ts`         | Remove rehype-mermaid import + plugin                 | PASS                 |
| `package.json`                   | Swap rehype-mermaid + playwright for mermaid ^11.13.0 | PASS                 |
| `components/Mermaid.tsx`         | New client-side component                             | PASS (dead ref note) |
| `components/MDXComponents.tsx`   | Register MermaidPre override                          | PASS                 |
| `layouts/ListLayout.tsx`         | JSX formatting only                                   | PASS                 |
| `layouts/ListLayoutWithTags.tsx` | JSX formatting only                                   | PASS                 |

---

## Decision

**APPROVED.** The implementation is correct, SSR-safe, handles dark mode and errors, and fully removes the Playwright build dependency. Minor issues noted above are follow-up candidates, not blockers.

Review complete — no critical issues. Auto-handing off to /qa.
