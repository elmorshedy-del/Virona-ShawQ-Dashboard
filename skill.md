# Skill: Insight Engineering (Guidelines)

## Rules
- No magic numbers for thresholds/heuristics. Use named constants/config objects (e.g., `INSIGHT_THRESHOLDS`) so they’re readable, reviewable, and easy to tune later.
- No hardcoded tunables (thresholds, time windows, scoring cutoffs). Use named constants/config and keep them centralized.
- Build as future SaaS by default: every feature/function must be tenant-aware and work for any client shop/account, not only a single brand/store.
- Do not hardcode client-specific store names, domains, SKUs, or assumptions into core logic unless explicitly requested and isolated behind config/feature flags.
- Optimize for maintainability and readability: favor clear abstractions, predictable data flow, minimal surprise, and code that can be safely modified by future engineers.
- Keep changes review-friendly: avoid large monolithic code drops; split into focused modules/functions with clear responsibilities.
- Keep account evolution flexible: support future account/shop onboarding, account-specific rules, and schema changes through configuration and scoped extension points.
- Apply secure engineering defaults for external attacker resistance: validate/sanitize untrusted inputs, enforce authN/authZ and tenant boundaries, avoid exposing sensitive data, apply least-privilege access, and add abuse controls (rate limits, safe error handling, audit-friendly logs).

## Required pre-PR checks
- Multi-tenant completeness check: after any tenant/account refactor, verify there are no hardcoded store identifiers left in write/read/query/log paths.
- Schema reality check: before using any table, confirm it exists in `server/db/database.js`; if provider data may be absent, implement fallback behavior.
- Migration observability check: do not use silent catch blocks for data backfills; log warnings with operation context.
