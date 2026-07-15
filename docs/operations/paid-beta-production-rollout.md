# Paid-beta production rollout and recovery

This is a runbook for a separately authorized rollout. Do not run it as part of implementation or review.

## Current verified migration state

At implementation time, a read-only `prisma migrate status` against the explicitly identified production project reported:

- `20260710010000_add_bulk_intake` was not applied.
- `20260711010000_paid_beta_p0_readiness` was not applied.
- `20260712012000_create_account_scoped_notification_dedupe` builds the
  account-scoped replacement, then
  `20260712012100_drop_global_notification_dedupe` removes the global index.
- the target ledger contained `20260709000000_enable_app_table_rls`, which was initially absent from repository migration history.

The missing migration was recovered byte-for-byte from the archived source checkout and independently reconstructed from the original recorded authoring session. Its SHA-256, `be74518339e786761816721db2b3aaabffb8d4801024bc6dcc4c5cb0e6a1c10b`, exactly matches the successful production Prisma ledger row. That row started at `2026-07-09T05:32:03.906371Z`, finished at `2026-07-09T05:32:04.754266Z`, has one applied step, and was not rolled back. The recovered file is now restored at `prisma/migrations/20260709000000_enable_app_table_rls/migration.sql`.

No Git commit or PR containing that migration exists: it was authored and applied from an uncommitted `develop` working tree after explicit owner authorization. The original local deploy command and the final three authoring revisions are preserved in the session record; exhaustive retained Git/GitHub searches found no source object. This is a provenance gap, not a byte or ledger ambiguity. Never use `prisma migrate resolve`, edit/delete the ledger row, or substitute reconstructed SQL: only the restored checksum-matching file is authoritative.

The recovered migration and the four pending migrations do not contain `BEGIN`/`COMMIT`; Prisma's PostgreSQL migration execution does not make each entire file atomic by default. A failed deploy can therefore leave earlier statements applied even when the migration ledger row is unfinished. Recovery must inspect both the ledger and actual catalog state before any retry.

## Lock analysis and expected production scale

The reviewed target is Supabase project `xkovtxrdxparbkuysunh`, database
`postgres`, reached through the direct port-5432 Supabase pooler class. On
2026-07-11, a metadata-only probe confirmed PostgreSQL 17.6, the expected project
reference in the configured connection identity, no active schema-change
session, and no granted advisory lock. Re-prove all of those facts immediately
before rollout; this observation is not a permanent readiness claim.

The same probe read only catalog/statistics estimates, never seller rows. The
largest affected existing relation was `ProviderCallLedger` at about 27 live
rows / 80 KiB. Estimates were: `Account` 2, `InventoryItem` 2,
`MarketplaceListing` 1, `SyncJob` 1, `Subscription` 1, `UsageCounter` 2, and
zero for `InventoryEvent`, `ReviewTask`, and `Notification`; every listed
relation was at most 112 KiB. `BulkBatch`, `BulkItem`, `BulkPhoto`,
`UsageReservation`, and `MarketplaceSaleSignal` did not yet exist, so their
initial indexes and constraints operate on new empty tables.

PostgreSQL/Prisma behavior relevant to this range:

- Prisma 7.8 does not wrap a PostgreSQL migration file in one transaction unless
  the SQL explicitly contains `BEGIN`/`COMMIT`; these files do not. Locks release
  after each statement, but a failure can leave a partial migration.
- Backfill `UPDATE`s take ordinary write/row locks only for matched rows.
- Most `ALTER TABLE` forms, including `SET NOT NULL`, take `ACCESS EXCLUSIVE`;
  `SET NOT NULL` scans the table unless a validated check proves nulls impossible.
- `ADD FOREIGN KEY ... NOT VALID` takes `SHARE ROW EXCLUSIVE` on both referencing
  and referenced tables. `VALIDATE CONSTRAINT` takes `SHARE UPDATE EXCLUSIVE`
  on the referencing table plus `ROW SHARE` on the referenced table and permits
  concurrent writes.
- A normal `CREATE INDEX` permits reads but blocks writes for its build. Given
  the measured sub-112-KiB relations, each scan/build is expected to finish in
  well under one second after acquiring its lock; allow up to 30 seconds for the
  complete four-migration range excluding lock waits and network latency.
- The notification repair uses two ordered, single-statement migrations: first
  `CREATE UNIQUE INDEX CONCURRENTLY`, then `DROP INDEX CONCURRENTLY`. Keeping
  each nontransactional statement alone avoids Prisma/PostgreSQL multi-statement
  transaction ambiguity. Ordinary reads/writes remain available, although the
  build may wait for old transactions and performs two scans.

Run only in a low-traffic window with inventory/sold-reconciliation workers
paused and marketplace/provider writes disabled. Stop before starting if any
affected existing relation is estimated above 10,000 rows or 100 MiB, any
ownership/null/duplicate preflight fails, another migration/schema-change
session is active, or a migration advisory lock is already held. During deploy,
abort on a lock wait over 5 seconds, total runtime over 60 seconds, an invalid
concurrent index, or any unexpected catalog/error state. Because statements may
already have committed, an abort enters the forward-recovery procedure below;
never blindly rerun or mark the migration applied.

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

4. Verify all four pending migration rows are finished with reviewed checksums and no rolled-back row.
5. Run the metadata checks below.
6. Deploy the reviewed application commit through the normal Vercel promotion workflow.
7. Keep paid-provider and live marketplace writes disabled.
8. Run application-only smoke tests with the dedicated test account.
9. Re-enable internal workers at minimum concurrency and inspect sanitized job/audit state.
10. Enable each provider/marketplace capability only under its separate approval and smoke plan.

The migration-first gap is compatible with the immediate predecessor application: database triggers populate account IDs for legacy bulk-child, job, event, review-task, and notification writes. Inventory account ownership has been populated by the earlier account-scope migration and becomes required here. Rolling the application back after the migration is supported only to that reviewed predecessor commit.

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
    'Notification_accountId_dedupeKey_key',
    'MarketplaceSaleSignal_account_marketplace_environment_event_key'
  );

SELECT i.relname AS index_name, x.indisvalid, x.indisready
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
WHERE i.relname IN (
  'Notification_accountId_dedupeKey_key',
  'Notification_dedupeKey_key'
);

SELECT tgname
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
    'BulkItem_populate_account_trigger',
    'BulkPhoto_populate_account_trigger',
    'BulkPhoto_item_ownership_trigger'
  );

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'BulkBatch', 'BulkItem', 'BulkPhoto', 'UsageReservation',
    'MarketplaceSaleSignal', 'Notification'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;
```

The compound notification index must be valid/ready and the old global index
must be absent. Diff grants against the pre-deploy metadata snapshot; the
migrations must not introduce an unreviewed `anon` or `authenticated` grant.
RLS must remain enabled on every new/exposed public table, with no permissive
policy added by this migration range.

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
11. Use three separate synthetic worker jobs: run one through transient failure, `retry_wait`, stale recovery, and success; place a second in `failed` or `needs_review` and verify admin retry; cancel a third while it is still `queued` or `retry_wait`, before external work begins. Confirm no raw provider text appears in any job, event, task, notification, or response.
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

Migration failure before the final statement:

- do not mark the migration applied;
- preserve the error and target identity privately;
- assume earlier statements may have committed because these migration files are not wrapped in one transaction;
- compare the ledger, columns, constraints, indexes, triggers, functions, and policies to the reviewed SQL;
- do not blindly retry a non-idempotent `ALTER`/`CREATE` sequence;
- prepare an independently reviewed forward recovery or a catalog-aware retry plan.

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
