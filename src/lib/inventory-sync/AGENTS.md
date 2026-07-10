# Inventory synchronization safety rules

The root `AGENTS.md` remains canonical. Inventory sync is protected because errors can double-sell or strand live listings.

- Sold-state mutation, audit events, and required delist-job creation remain transactionally safe.
- Jobs are account-scoped, idempotent, lease/retry safe, and honest about terminal versus review-required outcomes.
- Never mark a marketplace action successful without verified adapter success.
- Conflicting sale signals preserve the original source and create explicit review evidence; they are never auto-resolved by overwriting state.
- Tests must cover concurrent signals, duplicate runs, lease/attempt exhaustion, manual-review fallbacks, and partial upstream failures.
