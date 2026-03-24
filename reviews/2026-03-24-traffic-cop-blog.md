# Review: Blog Post — Building a Traffic Cop for AI Agents

**Project**: ghostpen
**Date**: 2026-03-24
**PR**: #51
**Files Reviewed**: `data/blog/2026-03-24-building-a-traffic-cop-for-ai-agents.mdx`
**Reviewer Persona**: Gemini 2.5 Pro (via Traffic Cop API dispatch)

---

## Critical Issues

### 1. Factual Inaccuracy: Gemini Free Tier Rate Limit
**Location**: Table under "The Rate Limit Trick That Changed Everything"
The post states Gemini's free tier is "15 RPM". The current Gemini free tier limit is 60 RPM. This is a significant factual error that undermines the post's credibility.
**Fix**: Change "15 RPM" to "60 RPM" (or verify current actual rate and update accordingly).

### 2. Factual Inaccuracy: Status of pr-poller Split
**Location**: "What I'd Do Differently" section
The post says: "The split is planned now, but I burned several hours debugging duplicate spawns first." This is stale — PR #764 already shipped this split (merged 2026-03-24). Publishing this as "planned" is inaccurate.
**Fix**: Update tense to reflect completion — e.g., "The split was implemented shortly after, but I burned several hours debugging duplicate spawns first."

---

## Dependency Direction Violations

None — this is a blog post with no cross-project dependencies.

---

## Separation of Concerns Violations

None applicable — pure content file.

---

## Warnings

### 1. Abrupt Ending
**Location**: Near line 122
"Cool!" is unprofessional for a published blog post. The preceding paragraph is a strong conclusion. Remove "Cool!" entirely.

### 2. Typo in Opening Line
**Location**: First paragraph
"I ve been running..." is missing an apostrophe. Should be "I've been running...".

---

## Suggestions

1. **Add `## Introduction` header** for structural consistency with the circuit-breaker post style reference.
2. **Add language specifier** to the JSON code block in "Traffic Cop: The Design" for syntax highlighting.
3. **Rephrase the "subtle bug" description** — the current wording is dense. Suggest: "The engine incorrectly defaults to 'API' mode for a provider if even one persona uses it, ignoring that other personas might need 'CLI' mode."
4. **Hint at deliberation engine follow-up** post in that section — it's a strong hook.

---

## Good Patterns

- Excellent narrative structure (problem → solution → billing surprise → lesson)
- Clear explanation of why the simple abstraction layer failed (loss of in-process context)
- Frontmatter style is consistent with other posts (quoted dates, inline array tags)
- Actionable takeaway for other AI developers

---

## Pipeline Verdict

**2 critical issues found** — factual inaccuracies that must be corrected before `draft: false`. Proceeding to QA for format/structure checks. Critical issues to be surfaced in PR comment.
