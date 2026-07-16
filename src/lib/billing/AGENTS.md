# Billing safety rules

The root `AGENTS.md` remains canonical. Billing changes require explicit contract scope and server-side tests.

- Resolve the active account before reading or mutating seller billing state.
- Enforce plan limits, roles, entitlements, and quotas on the server; client UI is explanatory only.
- Preserve Stripe webhook signature verification and event idempotency.
- Never expose Stripe secrets, raw provider payloads, customer identifiers beyond their intended server scope, or environment values.
- Do not create live checkout sessions, alter products/prices, call paid APIs, or mutate live billing during validation.
