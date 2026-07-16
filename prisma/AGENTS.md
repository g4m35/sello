# Prisma safety rules

The root `AGENTS.md` remains canonical. A task may change this directory only when `prisma/**` is explicitly allowed and the risk/reviewer are appropriate for database work.

- Preserve account ownership, idempotency constraints, auditability, and transaction-safety invariants.
- Never rewrite an applied migration or silently repair the production ledger.
- Prefer additive, forward-safe migrations. Document data backfills, failure behavior, rollout order, and rollback/mitigation.
- Run migration-focused tests, `npm run prisma:validate`, and `npm run validate:full`.
- Do not run `prisma migrate deploy`, production SQL, destructive resets, or shared-database mutations without explicit contract and owner authorization.
