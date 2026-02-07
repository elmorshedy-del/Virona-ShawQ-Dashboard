# Notes

## Engineering rules
- Always implement on a clean dedicated `codex/*` branch containing only this task's changes.
- Avoid **magic numbers** (especially thresholds/guardrails used for insights). Extract them into named constants or a config object close to the logic, and name them with units/meaning.
- Avoid hardcoded thresholds/time windows in business logic. Put tunable values in named constants/config so they can be changed safely later.
- Treat every implementation as **future SaaS multi-tenant** work. Any code/function must support many clients, each with their own connected shop(s), account(s), rules, and data boundaries.
- Avoid hardcoded store/client assumptions. Prefer tenant-scoped identifiers, configurable rules, and account-aware logic so features generalize to current and future shops.
- Prioritize maintainability and readability: clear naming, small composable functions, shared utilities over duplication, and explicit config over hidden behavior.
- Keep code reviewable: avoid giant monolithic files/blocks. Break large implementations into smaller cohesive functions/modules with clear interfaces.
- Keep implementations flexible for future account changes: design for evolving shops/accounts/tenants, changing schemas, and per-account overrides without rewrites.
- Build with security by default against external attackers: strict input validation/sanitization, authN/authZ checks, tenant data isolation, least-privilege access, safe secret handling, rate limiting, and no cross-tenant data leakage in queries, APIs, logs, or exports.

## Postmortem lessons (must enforce)
- Multi-tenant refactors must be end-to-end: when introducing account-aware logic, remove all remaining hardcoded tenant/store writes, reads, logs, and notifications in the same change.
- Never assume a table exists. Any query touching optional/provider-specific tables must be validated against `database.js` schema and have a safe fallback path.
- Best-effort migrations must not fail silently. Catch blocks must log warnings with enough context to investigate data integrity risks.
- Pre-PR tenant safety sweep is required: grep for legacy store keys and confirm all persistence/query paths are tenant-scoped.
