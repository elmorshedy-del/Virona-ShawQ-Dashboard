# Repository Agent Instructions

## Startup requirement
- At the start of every task, read and apply both `note.md` and `skill.md` in the repository root.
- Enforce the `Critical Thread-Start Guardrail (Mandatory)` section from `skill.md` before making edits.

## Product context defaults
- Treat this codebase as a future SaaS, multi-tenant platform.
- Any code, function, data model, sync, analytics pipeline, or UI feature must assume multiple clients, each with their own shop(s), account(s), and configuration.
- Avoid single-client hardcoding (store names, domains, SKU-specific logic, fixed assumptions) in core behavior.
- Prefer tenant-scoped logic, configurable rules, and reusable abstractions that generalize to future connected shops/accounts.
- Maintainability/readability are required defaults: write clear, modular, configurable code that is easy to review, test, and evolve.
- Keep code reviewable: do not ship giant monolithic blocks/files when avoidable; decompose into smaller cohesive modules/functions with explicit interfaces.
- No magic numbers or hardcoded business tunables in core logic; use named constants/config with clear meaning and units.
- Design for account/shop evolution: support future account changes and onboarding without brittle conditionals or tenant-specific rewrites.
- Security is a first-class requirement against outside attackers: validate/sanitize inputs, enforce authN/authZ, enforce tenant isolation, protect secrets, implement abuse defenses (rate limiting and safe error responses), and avoid any data paths that could cause cross-tenant leakage.
- Multi-tenant changes must be complete: when account-aware logic is introduced, eliminate hardcoded tenant/store values across writes, reads, filters, and logs in the same task.
- Validate schema usage before coding queries: any referenced table/column must exist in `server/db/database.js` or be guarded by a safe fallback path.
- Never silently swallow migration/data-backfill failures; log warning/error context for operational visibility.
