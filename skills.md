# Maintainability Rules

- Prefer data-driven mappings over repetitive conditional chains for normalization and classification logic.
- Keep processing loops derived from source-of-truth constants (for example, use `Object.keys(ISSUE_META)` rather than duplicated hardcoded type arrays).
- When matching signatures, store rules in structured configs (`keywords`, `match`, `label`) and keep the execution logic generic.
