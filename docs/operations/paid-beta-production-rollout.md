# Paid-beta production rollout and recovery

This is a runbook for a separately authorized rollout. Do not run it as part of implementation or review.

## Current verified migration state

At implementation time, the workspace was at `origin/develop` and the configured Prisma direct target was remote/shared. A read-only `prisma migrate status` reported:

- `20260710010000_add_bulk_intake` was not applied.
- the target ledger contained `20260709000000_enable_app_table_rls`, which was absent from repository migration history;
- the last common migration was `20260701010000_stockx_foundation`.

GitHub recorded no deployment for the bulk commit or then-current `develop`. This evidence is sufficient to avoid editing the existing bulk migration, but it does not prove every Preview/staging/production ledger. The corrections therefore live in forward migration `20260711010000_paid_beta_p0_readiness`.

The unknown `20260709000000_enable_app_table_rls` ledger entry is a rollout blocker. Recover its exact SQL and checksum from the system that applied it, add the authoritative migration to Git in correct order if approved, and compare actual metadata. Do not use `prisma migrate resolve`, mark it applied, delete the row, or invent replacement SQL.

## Authorization, target identity, and restore point

Before any command:

1. Obtain explicit owner approval naming Preview/staging/production, project ID, database host class, database name, Git commit, and migration range.
2. Confirm the shell target through approved platform metadata without printing URLs, tokens, or credentials.
3. Confirm no other migration/deploy is running.
4. Create and verify a provider-native backup or point-in-time restore point. Record its opaque identifier in the private rollout ticket, not Git.
5. Export only migration metadata and schema definitions needed for verification; do not read customer rows.
6. Require independent review of both bulk migrations and this runbook.

Safe ledger query:

```sql
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at;
```

## Deploy order

After the ledger divergence is resolved and approval is recorded:

1. Pause inventory and sold-reconciliation schedulers. Leave marketplace kill switches off.
2. Create/confirm the restore point.
3. Deploy migrations from the reviewed repository using exactly:

   ```bash
   npm run db:deploy
   ```

4. Verify both migration rows are finished with reviewed checksums and no rolled-back row.
5. Run the metadata checks below.
6. Deploy the reviewed application commit through the normal Vercel promotion workflow.
7. Keep paid-provider and live marketplace writes disabled.
8. Run application-only smoke tests with the dedicated test account.
9. Re-enable internal workers at minimum concurrency and inspect sanitized job/audit state.
10. Enable each provider/marketplace capability only under its separate approval and smoke plan.

The migration-first gap is compatible: database triggers populate bulk child account IDs for the old application, while all other new columns/tables are additive or nullable for legacy writes. Rolling the application back after the migration is also compatible.

## Metadata verification

Run against the explicitly named target. These queries inspect metadata only.

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS row_security
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('BulkBatch','BulkItem','BulkPhoto','UsageReservation','MarketplaceSaleSignal');

SELECT conname, convalidated
FROM pg_constraint
WHERE conname IN (
  'BulkItem_batchId_accountId_fkey',
  'BulkItem_inventoryItemId_accountId_fkey',
  'BulkPhoto_batchId_accountId_fkey',
  'UsageReservation_accountId_fkey',
  'MarketplaceSaleSignal_accountId_fkey'
);

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'UsageReservation_accountId_metric_idempotencyKey_key',
    'ProviderCallLedger_accountId_idempotencyKey_key',
    'MarketplaceSaleSignal_account_marketplace_environment_event_key'
  );

SELECT tgname
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
    'BulkItem_populate_account_trigger',
    'BulkPhoto_populate_account_trigger',
    'BulkPhoto_item_ownership_trigger'
  );
```

Do not run data-fixing SQL automatically if a constraint, index, trigger, or migration row is missing. Stop and prepare a reviewed forward migration.

## Dedicated test-account smoke test

Use a fresh Sello-owned account with synthetic photos and no real customer or marketplace data.

1. Sign in as the dedicated seller and confirm its account ID in the admin surface.
2. Create a two-item bulk batch with deterministic synthetic photos.
3. Refresh, close, and reopen the page; verify photo/group order and progress survive.
4. Regroup before generation and confirm it succeeds; start one item, then verify regrouping is rejected.
5. Generate one listing successfully and force one mocked/disabled-provider failure; verify partial progress and seller-safe copy.
6. Retry the failed item with capacity available; verify one canonical inventory item and one listing per bulk item.
7. Cancel the batch; verify the completed listing still opens and unfinished items are canceled.
8. Race two test requests for the final quota unit using the same account and different members; verify exactly one reservation is accepted.
9. Repeat a request with the same idempotency key; verify no second provider/marketplace operation.
10. With marketplace writes still disabled, submit synthetic eBay `PAID`, canceled, refunded, duplicate, and uncertain signals through the approved internal test harness. Verify sold/delist jobs only for the confirmed exact match and review tasks for uncertain/unmatched signals.
11. Run one synthetic worker job through transient failure, `retry_wait`, stale recovery, success, admin retry, and cancellation. Confirm no raw provider text appears.
12. Inspect account-scoped admin counts and audit events. Verify the other test account sees none of them.

No production marketplace publish/delist or paid provider call is part of this smoke test unless separately authorized.

## Rollback and forward recovery

Application regression with healthy migration:

- turn off affected feature/provider/marketplace switches;
- pause workers;
- roll the application back to the previously approved commit;
- leave the additive migration in place;
- verify old bulk writes receive child account IDs from triggers;
- prepare a forward application fix.

Migration failure before commit:

- do not mark the migration applied;
- preserve the error and target identity privately;
- verify PostgreSQL rolled back the failed migration transaction;
- prepare a corrected forward migration or retry only after independent review.

Migration committed but application unhealthy:

- do not drop tables, columns, enums, constraints, triggers, or ledger rows;
- disable new execution paths and roll back the application;
- restore the database only when the owner explicitly chooses point-in-time recovery and accepts all post-restore data loss;
- otherwise use a reviewed forward-only repair migration.

Worker/external-outcome uncertainty:

- keep the job in `retry_wait` or `needs_review`;
- reconcile remote state by idempotency key/listing/order before another write;
- never declare success from timeout alone;
- use the admin retry control only below `maxAttempts`;
- running external work cannot be canceled locally.

## Production claims checklist

Record each environment independently:

- migration prepared;
- migration applied with checksum;
- application deployed at commit;
- smoke test completed with test account;
- worker/provider/marketplace switches and approvals;
- production verification window and observed failures.

Never collapse these into a generic “done” status.
