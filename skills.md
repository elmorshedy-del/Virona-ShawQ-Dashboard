# Maintainability Rules

- Prefer data-driven mappings over repetitive conditional chains for normalization and classification logic.
- Keep processing loops derived from source-of-truth constants (for example, use `Object.keys(ISSUE_META)` rather than duplicated hardcoded type arrays).
- When matching signatures, store rules in structured configs (`keywords`, `match`, `label`) and keep the execution logic generic.

# UI/CRO Agent Guardrails

- Do not add `!important` in component-level CSS unless there is a documented override reason in a nearby comment.
- Never leave `catch {}` blocks empty; log with clear context (or explicitly document why swallowing is intentional).
- Memoize derived render metrics (`filter`, `map`, `reduce` over arrays) when they are recomputed each render and depend on stable inputs.
- For mutable approval/workflow state, do not rewrite large JSON blobs on each update; store per-item state in normalized tables and update inside a DB transaction.
- Keep report payloads as mostly immutable snapshots and hydrate live mutable state at read time.
