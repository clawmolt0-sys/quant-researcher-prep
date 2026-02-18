# Problem Quality Audit Summary (2026-02-18)

This audit was run to identify content/data quality issues affecting drill UX and recommendation quality.

## Scope
- Dataset: `data/problems.json`
- Total problems scanned: **1674**

## High-level findings
- Problems flagged with at least one issue: **948**
- Missing tags: **858**
- Short or missing solutions: **604**
- Short or missing statements: **28**
- Vague prompts (too broad/open): **18**
- Multi-question bundles (one row contains many independent questions): **77**

## Duplicate / near-duplicate content
Near-duplicate clusters were detected based on statement-level similarity (not title-only matching).

### Example clusters
- Dice Duel family centered around IDs like: `1379, 1617, 1302, 1259, 1257, 1220, 1197, 1602, 1604 ...`
- Dice Delight family centered around IDs like: `1236, 1671, 1592 ...`

These clusters can cause repetitive "similar problems" suggestions.

## Files included in this PR
- `audit/problem_quality_fix_list_full.json`
- `audit/problem_fix_lists_by_reason.json`
- `audit/deep_problem_validity_duplicate_audit.json`
- `audit/suggested_related_off_due_duplicate_families.json`

## Suggested triage order
1. Fill missing tags for high-traffic categories.
2. Fix/expand short solutions for high-visibility problems.
3. Split multi-question bundles into atomic problems.
4. Resolve duplicate families (merge/variant-link/suppress in recommendations).

