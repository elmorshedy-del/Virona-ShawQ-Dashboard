# Agent Coding Notes

- Use configuration-first patterns for extensible logic:
  - Selector and error normalization should read from rule tables.
  - Type iteration should come from canonical metadata objects.
- Avoid duplicating business categories across files or functions; define once and reuse.
- Refactors must preserve behavior and keep outputs identical unless a behavior change is explicitly requested.
