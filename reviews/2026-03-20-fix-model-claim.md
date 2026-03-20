# Review: Fix incorrect model assignment claim (ghostpen#35)

**Project**: ghostpen
**Date**: 2026-03-20
**Branch**: feature/fix-model-claim-35
**Files Reviewed**: data/blog/2026-03-15-what-is-ecoorchestra.mdx

## Critical Issues

None.

## Separation of Concerns Violations

None. This is a two-line factual correction to a blog post -- no code, no cross-project concerns.

## Warnings

None.

## Suggestions

None. The edits are minimal and accurate. Both changed lines now correctly describe the two-tier model strategy (Opus for vision/plan/build, Sonnet for review/QA), which matches:

- The diagram on line 24-25 showing `(opus) (opus) (opus) (sonnet) (sonnet)`
- The actual `config/personas.json` in EcoOrchestra
- Line 33's description of Review using "a different model than the developer" (still accurate -- Sonnet vs Opus)

The delegator voice is preserved. No unnecessary rewriting occurred.

## Good Patterns

- **Minimal diff**: Only two lines changed, both surgical corrections. No scope creep.
- **Text-diagram consistency**: The corrected text now aligns with the diagram that was already correct.
- **Accurate ground truth**: Claims verified against `EcoOrchestra/config/personas.json` -- all model assignments match.
