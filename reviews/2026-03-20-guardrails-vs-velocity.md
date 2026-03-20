# Review: Guardrails vs Velocity — Two Philosophies for AI-Assisted Development

**Post:** `data/blog/guardrails-vs-velocity.mdx`
**Branch:** `feature/guardrails-vs-velocity-28`
**Issue:** ghostpen#28
**Reviewer:** Reviewer persona (sonnet)
**Date:** 2026-03-20T17:55:58Z

---

## Summary

The post is fundamentally sound. The structure, framing, and voice all land. It demonstrates the philosophy-post approach well — real code from both tools, an honest bias statement, no marketing spin, and a conclusion that looks forward instead of recapping. There are no critical issues blocking publication. There are two warnings and several suggestions.

**Verdict: No critical issues. Ready for QA.**

---

## Critical Issues

None.

---

## Warnings

### W1 — EcoOrchestra internal link path does not match actual file slug

**Location:** Introduction, paragraph 2:
```
[EcoOrchestra](/blog/2026-03-15-what-is-ecoorchestra)
```

**Issue:** The issue spec (ghostpen#28) required the internal link to be `/blog/what-is-ecoorchestra`. The actual file on `origin/main` is `data/blog/2026-03-15-what-is-ecoorchestra.mdx`, which — depending on how Contentlayer2 derives slugs — may resolve as `/blog/2026-03-15-what-is-ecoorchestra` or `/blog/what-is-ecoorchestra`. The post uses the date-prefixed form. The style guide linking table lists the slug as `what-is-ecoorchestra` without the date prefix. If Contentlayer2 strips the date prefix from slugs (common behavior), the current link is wrong and will 404.

**Recommendation:** Verify the slug resolution by checking how the existing foundation posts route in dev. If Contentlayer2 strips the date prefix, change the link to `/blog/what-is-ecoorchestra`. If it preserves the date prefix, the link is correct but the style guide table should be updated to reflect that.

**Severity:** Warning — the link renders in the post body and will fail navigation if wrong.

---

### W2 — `dev-log` tag missing from frontmatter

**Location:** Frontmatter `tags` field:
```yaml
tags: ['ai', 'patterns', 'architecture']
```

**Issue:** The issue spec (ghostpen#28) required the tag list to be `['ai', 'patterns', 'architecture', 'dev-log']`. The `dev-log` tag is present on every other AI ecosystem post and is explicitly listed in the issue's frontmatter spec. It is absent from the published draft. The vision-approvals.json entry for `ecoorchestra-vs-ralph-blog-post` and the vision brief both list `dev-log` in the approved tag set.

**Recommendation:** Add `'dev-log'` to the tags array.

**Severity:** Warning — omitting an expected tag breaks tag-based navigation and diverges from the acceptance criteria. Not a hard rejection, but should be fixed before publication.

---

## Separation of Concerns

No violations found. The post correctly:
- Links Ralph to its external GitHub repo (not treated as an ecosystem project)
- Links EcoOrchestra to its internal foundation post (not to GitHub)
- Does not reference the War Room dashboard
- Contains no content that belongs in a different post or category

---

## Content Quality

### Checklist results

- [x] Investigation narrative — present and effective. The thundering herd bug story in "Why I Chose Governance" is the post's strongest moment. It shows a concrete situation where the governance approach caught something the velocity approach would have missed. This is exactly the kind of narrative the style guide calls for.
- [x] Real code excerpts from EcoOrchestra — `personas.json` (truncated, see note below), `vision-approvals.json` entry (real, matches file), pipeline enforcement description
- [x] Real code excerpts from Ralph — `ralph.sh` loop structure (matches the documented loop in the vision brief), `prd.json` format (matches the spec in the vision brief)
- [x] Comparison table — present, complete, covers all eight dimensions specified in the issue
- [x] Pipeline diagrams — both present and accurate. EcoOrchestra diagram shows fix loops. Ralph diagram shows the COMPLETE signal and iteration cap.
- [x] Balanced framing — the post acknowledges the asymmetry (Tim built one, discovered the other) up front and does not dismiss Ralph's approach. The "When velocity-first wins" section is genuine, not a token concession.

### Note on personas.json excerpt accuracy

The post's `personas.json` excerpt is a truncated version of the real file. The real file has 26 lines including `description` fields. The post simplifies these descriptions (e.g., "Decomposes features into task specs." vs the actual "Decomposes features into task specs. Needs strong reasoning for dependency analysis and extraction decisions."). The post also omits the `researcher` role from the excerpt.

This is acceptable — code excerpts are illustrative, not exhaustive, and the post is explaining a concept rather than documenting the full config. However, the excerpt is presented without any "abbreviated for clarity" framing. This is a minor issue. If a reader inspects the actual repo, they will see the full file differs from what's shown.

**Recommendation (suggestion, not warning):** Add a comment like `// simplified` or `// key roles shown` to the JSON block so readers know it is not the full file. Not a rejection criterion.

---

## Voice Compliance

- [x] Delegator/architect voice — consistently maintained throughout. The post does not claim Tim wrote any code. The language is "runs every change through a pipeline," "catches what the Opus instance is blind to," "the pipeline is not optional" — all describing what the system does, not what Tim wrote.
- [x] No "I wrote" or hands-on coding claims — absent throughout.
- [x] No corporate hedging — no "it should be noted," "it is worth mentioning," or similar. The post is direct throughout.
- [x] No AI tells — no "let's delve into," "in conclusion," "in this blog post I will." The section headers are conceptual labels, not AI-style lead-ins.
- [x] No War Room dashboard references — absent. Confirmed clean.

One minor voice observation: the phrase "I spent a few hours reading through Ralph's source code" is technically a hands-on claim, but it is accurate — Tim did read Ralph's source. Reading is within the architect/delegator role. The style guide does not prohibit research activities, only fabricated coding claims. This is fine.

---

## Technical Accuracy

### EcoOrchestra pipeline

The pipeline description in the post matches CLAUDE.md:
- `/vision → /plan → /build → /review → /qa → /ship` — correct
- Reviewer and QA use sonnet; vision, planner, developer use opus — matches `config/personas.json` exactly
- Fix loops shown in the diagram — matches the CLAUDE.md pipeline enforcement section
- 7-day vision gate expiry — confirmed in `vision-approvals.json` (`"expires"` field is 7 days out from timestamp)
- Edit hooks block code modifications without active developer persona — matches CLAUDE.md hook descriptions

### vision-approvals.json excerpt

The post shows the `anthropic-failover-strategy` entry. Confirmed against actual file — all fields match exactly (feature, summary, placement, blast_radius, status, timestamp, expires). The excerpt is accurate.

### Ralph description

The Ralph loop description matches the vision brief's documentation of Ralph's behavior: parse PRD, spawn fresh AI, implement, quality checks, commit, mark complete, repeat. The `ralph.sh` excerpt in the post (using `cat prompt.md | amp --dangerously-allow-all` and checking for `<promise>COMPLETE</promise>`) matches the sources cited in the issue spec. The `prd.json` format matches the documented schema.

**One unverifiable claim:** The post presents the `ralph.sh` bash loop as a direct excerpt. The Reviewer cannot access the live GitHub repo to verify byte-for-byte accuracy of the loop structure. The vision brief states the loop uses these exact patterns and the post aligns with the brief. If the developer fetched from `https://raw.githubusercontent.com/snarktank/ralph/main/ralph.sh` as instructed, it should be accurate. Mark as unverified but likely correct.

---

## Frontmatter Compliance

| Field | Required | Value in post | Status |
|-------|----------|---------------|--------|
| `aiGenerated` | `true` | `true` | Pass |
| `draft` | `true` | `true` | Pass |
| `title` | as specified | matches issue spec exactly | Pass |
| `date` | `2026-03-20` | `2026-03-20` | Pass |
| `summary` | compelling, non-hype | present, engaging | Pass |
| `tags` | `['ai', 'patterns', 'architecture', 'dev-log']` | missing `dev-log` | **Fail** (W2 above) |
| `authors` | `['default']` | `['default']` | Pass |

---

## Linking Rules

| Link | Type | Target | Status |
|------|------|--------|--------|
| `[EcoOrchestra](/blog/2026-03-15-what-is-ecoorchestra)` | Internal | EcoOrchestra foundation post | Verify slug (W1 above) |
| `[Ralph](https://github.com/snarktank/ralph)` | External | Ralph GitHub repo | Correct |
| `[circuit breaker feature](/blog/2026-03-20-building-a-circuit-breaker-across-two-repos)` | Internal | Circuit breaker post | Correct (file exists on main) |

---

## Style Guide Checks

- [x] Code blocks present — 5 code blocks (pipeline diagram, personas.json, vision-approvals.json entry, ralph.sh loop, prd.json). Exceeds the minimum of 1. Passes the "no code → reject" criterion.
- [x] Investigation narrative present — the thundering herd bug story is a genuine investigation narrative showing why a decision was made. Passes the "no investigation → reject" criterion.
- [x] Casual interjections — "Ok. Honest answer." in "Why I Chose Governance" is the only explicit interjection. The style guide requires 2-3. One is marginal. The tone is casual throughout, but the explicit short-sentence interjections are sparse.
- [x] No conclusion recap — the final two paragraphs look forward (hybrid approaches, industry convergence). Passes.
- [x] No listicle format — the post is a narrative, not a top-N list. Passes.
- [x] No abstract introduction — opens with "I built one of these. I discovered the other." — concrete and direct. Passes.

### Casual interjections (marginal)

The style guide requires "at least 2-3 natural casual moments — short reactions like 'Ok. That's new.', 'Cool!', 'So, now what?'." The post has one: "Ok. Honest answer." The overall tone is informal, but the voice rule specifically calls for these short punchy moments. With one explicit instance, the post is at the low end of the requirement. The circuit breaker post likely had more of these. This is not a rejection criterion — one is enough to pass — but adding one more would strengthen the voice match.

---

## Suggestions

**S1 — Add casual interjection in the Ralph section.** The Ralph loop section is purely analytical. A brief reaction when the author first saw the loop structure ("That loop is absurdly simple. Intentionally so.") would add the voice texture the style guide calls for without breaking the balance.

**S2 — Clarify that the personas.json excerpt is abbreviated.** Add a comment or prose note so readers know they are seeing a simplified version of the config. Prevents a "wait, that's not what I see in the repo" moment for technical readers.

**S3 — Consider adding "researcher: haiku" to the personas.json excerpt.** The blog's own analysis in the CLAUDE.md notes that haiku is used for the researcher role specifically because it is the cheapest model for reading/summarizing tasks. That design decision is interesting and on-theme for a governance post. Currently the excerpt silently omits it.

**S4 — The EcoOrchestra diagram uses a text pipeline, not a Mermaid diagram.** The issue spec required Mermaid diagrams. The post uses plain-text ASCII art inside a code fence for both pipeline diagrams. The conceptual-blog-posts vision brief says "Avoid ASCII art. Mermaid is more maintainable and renders better." This is not a hard rejection since the diagrams are still functional code blocks, and the vision brief also says Mermaid diagrams count as code blocks for the conceptual posts category. But the stated tooling preference is Mermaid, and the issue spec says "Mermaid diagram." Flag for the developer to assess whether to convert.

---

## Good Patterns

- The thundering herd bug narrative is the best content in the post. It is specific, it is honest about what the tests would and would not have caught, and it makes the philosophical point concretely without claiming superiority. This is exactly the kind of investigation narrative that the style guide requires and that makes AI posts readable.
- The "I am not dismissing that trade-off — I am saying it is the wrong trade-off for my situation" line is exactly the tone the vision brief asked for. Balanced without being mealy-mouthed.
- The comparison table is clean and accurately covers all eight dimensions from the vision brief.
- The conclusion avoids the common failure mode of summarizing what was just covered. It makes an observation about where the industry is heading that gives the reader something to think about.
- Delegator voice is consistently maintained without becoming awkward or formulaic. The shift from Sitecore hands-on voice to AI delegator voice is handled well.

---

## Medium-Severity Findings for GitHub Issues

The following findings are real problems but not critical blockers. Per review policy, medium-severity findings are tracked as GitHub Issues.

1. **W1** (EcoOrchestra link slug) — will be filed as a GitHub Issue in tyu41275/ghostpen
2. **W2** (missing `dev-log` tag) — will be filed as a GitHub Issue in tyu41275/ghostpen

---

## Decision

**No critical issues found.**

Handoff: Auto-handing off to /qa.
