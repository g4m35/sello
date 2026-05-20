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
