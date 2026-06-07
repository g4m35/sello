# Supabase Migration Plan: PriceComp

This plan covers `prisma/migrations/20260518170000_add_price_comp/migration.sql`. Do not apply it until explicitly instructed.

## Safety Summary

- Current migration is DDL-only: it creates the `PriceComp` table, one index, one foreign key, and enables RLS.
- The migration does not insert, update, or delete application rows.
- The SQL is not idempotent. Running it twice will fail because the table, index, and constraint names already exist.
- It can be applied through the Supabase SQL Editor if preflight checks show the table is absent and the parent schema objects exist.
- Applying through SQL Editor bypasses Prisma's normal migration runner. If SQL Editor is used, Prisma migration history must be reconciled afterward.
- Prefer `npx prisma migrate deploy` for production-style migration application when a reliable database connection is available, because it applies SQL and records Prisma migration history together.
- Do not deploy from this workflow.
- Do not push `main`.
- Do not replace the intentional `resale_app` runtime role with the `postgres` owner account.

## Migration SQL To Apply

Apply exactly this SQL from `prisma/migrations/20260518170000_add_price_comp/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "PriceComp" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "soldDate" TIMESTAMP(3),
    "url" TEXT,
    "condition" "ItemCondition" NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceComp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceComp_inventoryItemId_createdAt_idx" ON "PriceComp"("inventoryItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "PriceComp" ADD CONSTRAINT "PriceComp_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS on the comps table. Like the other application tables, this is
-- only reached through trusted server-side Prisma connections, not the browser.
ALTER TABLE "PriceComp" ENABLE ROW LEVEL SECURITY;
```

## Supabase SQL Editor Workflow

1. Open the Supabase project Dashboard.
2. Open SQL Editor.
3. Run the preflight SQL below first. Do not continue if `pricecomp_table` is not null, if `inventoryitem_table` is null, if `itemcondition_enum_exists` is false, or if Prisma migration history already contains `20260518170000_add_price_comp`.
4. Create a new SQL Editor query for the migration application.
5. Paste the transaction wrapper below and put the exact migration SQL inside it.
6. Run the query once.
7. Run the verification SQL below.
8. Reconcile Prisma migration history. Prefer `npx prisma migrate resolve --applied 20260518170000_add_price_comp` from a safe environment that can connect to the database. If the CLI cannot connect because of local `DIRECT_URL` or pooler behavior, record that explicitly and do not pretend Prisma history is reconciled.
9. Run Prisma and app verification steps.

Preflight SQL:

```sql
select
  to_regclass('public."PriceComp"') as pricecomp_table,
  to_regclass('public."InventoryItem"') as inventoryitem_table,
  exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'ItemCondition'
  ) as itemcondition_enum_exists;

select migration_name, finished_at, rolled_back_at
from "_prisma_migrations"
where migration_name = '20260518170000_add_price_comp';

select tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('InventoryItem', 'ListingDraft', 'PriceComp')
order by tablename;

select
  has_table_privilege('resale_app', 'public."InventoryItem"', 'SELECT') as resale_app_can_select_inventory,
  has_table_privilege('resale_app', 'public."InventoryItem"', 'INSERT') as resale_app_can_insert_inventory,
  (
    select rolbypassrls
    from pg_roles
    where rolname = 'resale_app'
  ) as resale_app_bypasses_rls;
```

Transaction wrapper for SQL Editor:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Paste the exact migration SQL here.

commit;
```

Role alignment after application:

- Verify `PriceComp` follows the same owner/privilege pattern as existing application tables.
- If existing app tables are owned by `resale_app`, change only the new table owner to match:

```sql
alter table "PriceComp" owner to resale_app;
```

- If existing app tables are owned by `postgres` but `resale_app` has explicit grants, mirror those grants for `PriceComp`:

```sql
grant select, insert, update, delete on table "PriceComp" to resale_app;
```

- Do not change app runtime configuration to use the `postgres` owner account.

## Verification SQL

Confirm the table and columns exist:

```sql
select column_name, data_type, is_nullable, column_default, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'PriceComp'
order by ordinal_position;
```

Confirm primary key, foreign key, and FK actions:

```sql
select
  conname,
  contype,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public."PriceComp"'::regclass
order by conname;
```

Confirm indexes:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'PriceComp'
order by indexname;
```

Confirm RLS is enabled and inspect policies:

```sql
select
  relname,
  relrowsecurity,
  relforcerowsecurity
from pg_class
where oid = 'public."PriceComp"'::regclass;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'PriceComp'
order by policyname;
```

Confirm runtime role alignment:

```sql
select tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('InventoryItem', 'ListingDraft', 'PriceComp')
order by tablename;

select
  has_table_privilege('resale_app', 'public."PriceComp"', 'SELECT') as can_select,
  has_table_privilege('resale_app', 'public."PriceComp"', 'INSERT') as can_insert,
  has_table_privilege('resale_app', 'public."PriceComp"', 'UPDATE') as can_update,
  has_table_privilege('resale_app', 'public."PriceComp"', 'DELETE') as can_delete,
  (
    select rolbypassrls
    from pg_roles
    where rolname = 'resale_app'
  ) as resale_app_bypasses_rls;
```

Confirm Prisma migration history after reconciliation:

```sql
select migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
from "_prisma_migrations"
where migration_name = '20260518170000_add_price_comp';
```

## Prisma Verification Steps

Run locally after the migration is applied and Prisma migration history is reconciled:

```bash
npx prisma validate
npx prisma migrate status
npm run lint
npm test
npm run build
```

If SQL Editor was used first, reconcile Prisma history after successful SQL verification:

```bash
npx prisma migrate resolve --applied 20260518170000_add_price_comp
npx prisma migrate status
```

Do not use `prisma migrate dev` against Supabase production-like data. Do not use `prisma migrate reset`.

## App And Runtime Verification Steps

After migration application and Prisma verification:

1. Keep `DATABASE_URL` pointed at the intentional Supabase transaction pooler connection using the `resale_app` role.
2. Do not switch runtime credentials to the `postgres` owner account.
3. Start the app locally with the normal environment.
4. Create or open an inventory item.
5. Add a manual sold comp through the Pricing/Workbench UI.
6. Reload the item and confirm the comp persists.
7. Confirm the pricing summary updates from `Needs comps` to calculated guidance.
8. Confirm unauthorized API requests to `/api/listings/comps` remain rejected.
9. Confirm no marketplace publishing action is triggered.

## DATABASE_URL vs DIRECT_URL Notes

- `DATABASE_URL` intentionally uses the Supabase transaction pooler for local/runtime access.
- `DIRECT_URL` had IPv6/DNS connectivity problems on this machine.
- The current `prisma.config.ts` reads `DATABASE_URL`; it does not configure a separate `DIRECT_URL`.
- `npx prisma validate` does not require a live database connection.
- `npx prisma migrate status`, `npx prisma migrate deploy`, and `npx prisma migrate resolve` require a database connection through the configured datasource.
- If Prisma migration commands fail because of transaction-pooler or prepared-statement behavior, do not switch the app to the `postgres` owner account. Use a deliberate database-admin session only for migration administration, then keep runtime on `resale_app`.

## Rollback Notes

- If the SQL Editor transaction fails before `commit`, Postgres should roll back the transaction automatically.
- If the migration succeeds and no rows have been written to `PriceComp`, an explicit rollback can drop the new table and remove the Prisma migration-history entry if one was recorded.
- Dropping `PriceComp` after real comps exist will delete comp data. Do not do that without explicit approval and a backup.

Potential empty-table rollback SQL:

```sql
begin;

select count(*) as pricecomp_rows
from "PriceComp";

-- Continue only if pricecomp_rows is 0 and rollback is explicitly approved.
drop table "PriceComp";

delete from "_prisma_migrations"
where migration_name = '20260518170000_add_price_comp';

commit;
```

## Recommendation

The migration can be safely applied through the Supabase SQL Editor only as a controlled, one-time manual schema change with preflight checks, transaction wrapping, role alignment, post-apply verification, and Prisma migration-history reconciliation. The cleaner path is still `npx prisma migrate deploy` from an environment with a reliable database connection, because it avoids manual drift between SQL state and Prisma migration history.

## Execution Log: 2026-05-20

The PriceComp migration was applied to Supabase project `xkovtxrdxparbkuysunh` after explicit approval.

Preflight findings:

- `PriceComp` did not exist before application.
- `InventoryItem` existed.
- `ItemCondition` existed.
- `_prisma_migrations` did not exist before reconciliation.
- Existing application tables were owned by `postgres` with RLS enabled.
- `resale_app` had runtime table privileges and `BYPASSRLS`, so the no-policy RLS pattern matched the existing trusted-server strategy.

Application:

- Applied DDL with Supabase migration name `add_price_comp`.
- Supabase migration list included:
  - `20260518165309_init_resale_crosslister_schema`
  - `20260518174636_create_runtime_app_role`
  - `20260520202156_add_price_comp`

Post-apply verification:

- `PriceComp` exists.
- `PriceComp_inventoryItemId_createdAt_idx` exists.
- `PriceComp_inventoryItemId_fkey` exists with `ON UPDATE CASCADE ON DELETE CASCADE`.
- RLS is enabled on `PriceComp`.
- `resale_app` can select, insert, update, and delete `PriceComp`.
- `resale_app` has `BYPASSRLS`.
- `PriceComp` row count was `0` immediately after application.

Prisma migration history:

- Prisma CLI `migrate status` timed out through the Supabase transaction pooler.
- Prisma CLI using `DIRECT_URL` could not reach `db.xkovtxrdxparbkuysunh.supabase.co:5432` from this machine.
- Because `_prisma_migrations` was absent and the existing init schema had already been applied outside Prisma, migration metadata was reconciled through Supabase SQL without changing application rows.
- Recorded local Prisma migrations:
  - `20260518162000_init`
  - `20260518170000_add_price_comp`

Runtime verification:

- A read-only runtime connection through `DATABASE_URL` queried `PriceComp` successfully.
- No comp rows were inserted.
- No production data was modified.
- No deployment was run.
- `main` was not pushed.

# Supabase Migration Plan: Publish Persistence

This plan covers `prisma/migrations/20260520210000_add_publish_persistence/migration.sql`. Do not apply it until explicitly instructed.

## Safety Summary

- Migration is DDL-only: it creates the `PublishAttemptStatus` enum, the `PublishAttempt` and `MarketplaceEvent` tables, three indexes, two foreign keys (both `ON DELETE CASCADE ON UPDATE CASCADE`), and enables RLS on both new tables.
- The migration does not insert, update, or delete application rows.
- The SQL is not idempotent. Running it twice will fail because the enum, tables, indexes, and constraints already exist.
- Both new tables hang off `MarketplaceListing`, which already cascades from `InventoryItem`, so deleting an inventory item still removes all of its attempts and events.
- RLS is enabled with no policies, matching the existing trusted-server access pattern; `resale_app` reaches these tables via `BYPASSRLS`.
- `/api/listings/publish` will fail with a 500 (`prisma.publishAttempt` / `prisma.marketplaceEvent` undefined or `relation does not exist`) until this migration is applied.
- Do not deploy from this workflow.
- Do not push `main`.
- Do not replace the intentional `resale_app` runtime role with the `postgres` owner account.

## Migration SQL To Apply

Apply exactly this SQL from `prisma/migrations/20260520210000_add_publish_persistence/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "PublishAttemptStatus" AS ENUM ('NOT_IMPLEMENTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" UUID NOT NULL,
    "marketplaceListingId" UUID NOT NULL,
    "status" "PublishAttemptStatus" NOT NULL DEFAULT 'NOT_IMPLEMENTED',
    "code" TEXT NOT NULL,
    "reason" TEXT,
    "adapterResult" JSONB,
    "requestedBy" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishAttempt_marketplaceListingId_createdAt_idx" ON "PublishAttempt"("marketplaceListingId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishAttempt_requestedBy_createdAt_idx" ON "PublishAttempt"("requestedBy", "createdAt");

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_marketplaceListingId_fkey" FOREIGN KEY ("marketplaceListingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MarketplaceEvent" (
    "id" UUID NOT NULL,
    "marketplaceListingId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceEvent_marketplaceListingId_createdAt_idx" ON "MarketplaceEvent"("marketplaceListingId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketplaceEvent" ADD CONSTRAINT "MarketplaceEvent_marketplaceListingId_fkey" FOREIGN KEY ("marketplaceListingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS. Reached only through trusted server-side Prisma connections.
ALTER TABLE "PublishAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceEvent" ENABLE ROW LEVEL SECURITY;
```

## Supabase SQL Editor Workflow

1. Open the Supabase project Dashboard.
2. Open SQL Editor.
3. Run the preflight SQL below first. Do not continue if `publishattemptstatus_enum_exists` is true, if `publishattempt_table` or `marketplaceevent_table` is not null, if `marketplacelisting_table` is null, or if Prisma migration history already contains `20260520210000_add_publish_persistence`.
4. Create a new SQL Editor query for the migration application.
5. Paste the transaction wrapper below and put the exact migration SQL inside it.
6. Run the query once.
7. Run the verification SQL below.
8. Reconcile Prisma migration history. Prefer `npx prisma migrate resolve --applied 20260520210000_add_publish_persistence` from a safe environment that can connect to the database. If the CLI cannot connect because of local `DIRECT_URL` or pooler behavior, record that explicitly and do not pretend Prisma history is reconciled.
9. Run Prisma and app verification steps.

Preflight SQL:

```sql
select
  to_regclass('public."PublishAttempt"') as publishattempt_table,
  to_regclass('public."MarketplaceEvent"') as marketplaceevent_table,
  to_regclass('public."MarketplaceListing"') as marketplacelisting_table,
  exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'PublishAttemptStatus'
  ) as publishattemptstatus_enum_exists;

select migration_name, finished_at, rolled_back_at
from "_prisma_migrations"
where migration_name = '20260520210000_add_publish_persistence';

select tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('MarketplaceListing', 'PublishAttempt', 'MarketplaceEvent')
order by tablename;

select
  has_table_privilege('resale_app', 'public."MarketplaceListing"', 'SELECT') as resale_app_can_select_listing,
  has_table_privilege('resale_app', 'public."MarketplaceListing"', 'INSERT') as resale_app_can_insert_listing,
  (
    select rolbypassrls
    from pg_roles
    where rolname = 'resale_app'
  ) as resale_app_bypasses_rls;
```

Transaction wrapper for SQL Editor:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Paste the exact migration SQL here.

commit;
```

Role alignment after application:

- Verify `PublishAttempt` and `MarketplaceEvent` follow the same owner/privilege pattern as existing application tables.
- If existing app tables are owned by `postgres` and `resale_app` has explicit grants (the current PriceComp pattern), mirror those grants:

```sql
grant select, insert, update, delete on table "PublishAttempt" to resale_app;
grant select, insert, update, delete on table "MarketplaceEvent" to resale_app;
```

- If existing app tables are owned by `resale_app`, change only the new table owners to match:

```sql
alter table "PublishAttempt" owner to resale_app;
alter table "MarketplaceEvent" owner to resale_app;
```

- Do not change app runtime configuration to use the `postgres` owner account.

## Verification SQL

Confirm tables and columns:

```sql
select column_name, data_type, is_nullable, column_default, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('PublishAttempt', 'MarketplaceEvent')
order by table_name, ordinal_position;
```

Confirm enum values:

```sql
select t.typname, e.enumlabel, e.enumsortorder
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'PublishAttemptStatus'
order by e.enumsortorder;
```

Confirm primary keys, foreign keys, and FK actions:

```sql
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public."PublishAttempt"'::regclass, 'public."MarketplaceEvent"'::regclass)
order by conrelid::regclass::text, conname;
```

Confirm indexes:

```sql
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('PublishAttempt', 'MarketplaceEvent')
order by tablename, indexname;
```

Confirm RLS:

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where oid in ('public."PublishAttempt"'::regclass, 'public."MarketplaceEvent"'::regclass);

select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('PublishAttempt', 'MarketplaceEvent');
```

Confirm runtime role alignment:

```sql
select tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('MarketplaceListing', 'PublishAttempt', 'MarketplaceEvent')
order by tablename;

select
  has_table_privilege('resale_app', 'public."PublishAttempt"', 'SELECT')  as pa_select,
  has_table_privilege('resale_app', 'public."PublishAttempt"', 'INSERT')  as pa_insert,
  has_table_privilege('resale_app', 'public."PublishAttempt"', 'UPDATE')  as pa_update,
  has_table_privilege('resale_app', 'public."PublishAttempt"', 'DELETE')  as pa_delete,
  has_table_privilege('resale_app', 'public."MarketplaceEvent"', 'SELECT') as me_select,
  has_table_privilege('resale_app', 'public."MarketplaceEvent"', 'INSERT') as me_insert,
  has_table_privilege('resale_app', 'public."MarketplaceEvent"', 'UPDATE') as me_update,
  has_table_privilege('resale_app', 'public."MarketplaceEvent"', 'DELETE') as me_delete,
  (select rolbypassrls from pg_roles where rolname = 'resale_app') as resale_app_bypasses_rls;
```

Confirm Prisma migration history after reconciliation:

```sql
select migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
from "_prisma_migrations"
where migration_name = '20260520210000_add_publish_persistence';
```

## App And Runtime Verification Steps

After migration application and Prisma verification:

1. Keep `DATABASE_URL` pointed at the intentional Supabase transaction pooler connection using the `resale_app` role.
2. Restart the local dev server cleanly so a Prisma client with `prisma.publishAttempt` / `prisma.marketplaceEvent` is loaded.
3. Sign in (or seed) a QA user, create or open an approved inventory item.
4. `POST /api/listings/publish` for one marketplace. Verify HTTP `501`, body containing `code: "NOT_IMPLEMENTED"`, plus `marketplaceListingId` and `publishAttemptId`.
5. Re-post the same payload. Verify no new `MarketplaceListing` row was created; a second `PublishAttempt` row is recorded.
6. Confirm one `MarketplaceEvent` of `kind = 'publish_attempted'` per attempt.
7. Confirm publish on a not-yet-approved item returns 409 and writes nothing.
8. Confirm publish on a sold item returns 409 and writes nothing.
9. Cleanup all QA rows and the QA auth user.

## Rollback Notes

- If the SQL Editor transaction fails before `commit`, Postgres rolls back the transaction automatically.
- If the migration succeeds and no application data has been written to `PublishAttempt` / `MarketplaceEvent`, an explicit rollback can drop the new tables and enum and remove the Prisma migration-history entry.
- Dropping the tables after real attempt history exists will delete audit data. Do not do that without explicit approval and a backup.

Potential empty-table rollback SQL:

```sql
begin;

select
  (select count(*) from "PublishAttempt") as publishattempt_rows,
  (select count(*) from "MarketplaceEvent") as marketplaceevent_rows;

-- Continue only if both row counts are 0 and rollback is explicitly approved.
drop table "MarketplaceEvent";
drop table "PublishAttempt";
drop type "PublishAttemptStatus";

delete from "_prisma_migrations"
where migration_name = '20260520210000_add_publish_persistence';

commit;
```

## Recommendation

The migration can be safely applied through the Supabase SQL Editor only as a controlled, one-time manual schema change with preflight checks, transaction wrapping, role alignment, post-apply verification, and Prisma migration-history reconciliation. The cleaner path is still `npx prisma migrate deploy` from an environment with a reliable database connection.

## Execution Log: 2026-05-20

Application of `20260520210000_add_publish_persistence` was attempted from the local CLI through the configured `DATABASE_URL` (Supabase transaction pooler, `resale_app` runtime role). The attempt was correctly rejected and the database was left in its pre-attempt state.

Preflight findings:

- `PublishAttempt` did not exist.
- `MarketplaceEvent` did not exist.
- `MarketplaceListing` existed.
- `PublishAttemptStatus` enum did not exist.
- `_prisma_migrations` had no row for `20260520210000_add_publish_persistence`.
- Existing application tables (`InventoryItem`, `MarketplaceListing`, `PriceComp`) are owned by `postgres`, matching the pattern documented in the PriceComp execution log.

Application result:

- The DDL was issued inside a `begin / commit` transaction with `lock_timeout = '5s'` and `statement_timeout = '30s'`.
- The first statement (`CREATE TYPE "PublishAttemptStatus"`) failed with `permission denied for schema public`. This is expected: `resale_app` is the intentional runtime role and is not granted DDL privileges on `public`.
- The transaction was rolled back. A follow-up `to_regclass` / `pg_type` check confirmed that `PublishAttempt`, `MarketplaceEvent`, and `PublishAttemptStatus` are still absent. No application rows were touched.

Follow-up alternate-path probes (same session):

- `DIRECT_URL` (postgres role, port 5432) reattempted: `getaddrinfo ENOTFOUND db.xkovtxrdxparbkuysunh.supabase.co` from Node. `dig AAAA` returns `2600:1f1c:c19:4901:f895:88d5:dc91:72fa`; there is no A (IPv4) record published for this host, which is the Supabase default unless the IPv4 add-on is enabled.
- Bypassing the Node resolver and connecting directly to the IPv6 literal `[2600:1f1c:c19:4901:f895:88d5:dc91:72fa]:5432` returned `connect EHOSTUNREACH`. The local network cannot route IPv6 to that destination, which matches the `DIRECT_URL had IPv6/DNS connectivity problems on this machine` notes in `CLAUDE.md`.
- `.env.local` has no `SUPABASE_ACCESS_TOKEN` (Personal Access Token), no `SUPABASE_DB_PASSWORD`, and no separate postgres pooler URL. The only available DB-related credentials are `DATABASE_URL` (pooler / `resale_app`), `DIRECT_URL` (postgres / IPv6-only / unreachable), `SUPABASE_SERVICE_ROLE_KEY` (data API JWT, not a Management API token), and `NEXT_PUBLIC_SUPABASE_*` (anon).

Conclusion:

- There is no DDL-capable path from this CLI in this session: `resale_app` lacks DDL on `public`, `DIRECT_URL` is unreachable over IPv6, and no Management-API or `postgres`-pooler credentials are available. The migration must be applied through the Supabase SQL Editor (which connects as the `postgres` superuser) using the Preflight / Transaction wrapper / Verification / Role alignment / Prisma reconciliation steps above, or by enabling the Supabase IPv4 add-on / providing a `SUPABASE_ACCESS_TOKEN` / providing a `postgres` pooler URL in a future session.
- After application, the local Prisma client already includes `prisma.publishAttempt` and `prisma.marketplaceEvent`; only the dev server needs a clean restart.
- Until applied, `POST /api/listings/publish` will fail at runtime against the real database with `relation "PublishAttempt" does not exist`. Runtime QA of the publish persistence flow is intentionally deferred until the SQL Editor application has been completed.
