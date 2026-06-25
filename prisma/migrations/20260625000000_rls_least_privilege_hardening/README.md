# Migration: RLS least-privilege hardening

`20260625000000_rls_least_privilege_hardening`

> Do not apply this migration until explicitly instructed. It is DDL-only,
> changes no application rows, and is safe to review in isolation.

## 1. What this migration does

Two changes, both moving the schema to a uniform **deny-all** RLS posture:

1. **Enables RLS on `CompSearchRun`.** This table (created in
   `20260614120000_add_comp_search_runs`) was the only application table left
   without `ENABLE ROW LEVEL SECURITY`. It is now enabled with **no policy**,
   matching every sibling table.
2. **Drops the 8 eBay-connection `authenticated` policies** on
   `MarketplaceConnection` and `EbaySellerConfig`
   (`*_user_select/insert/update/delete`). RLS stays **enabled** on both tables;
   only the policies are removed, so they too become deny-all.

```sql
ALTER TABLE "CompSearchRun" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MarketplaceConnection_user_select" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "MarketplaceConnection_user_insert" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "MarketplaceConnection_user_update" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "MarketplaceConnection_user_delete" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "EbaySellerConfig_user_select" ON "EbaySellerConfig";
DROP POLICY IF EXISTS "EbaySellerConfig_user_insert" ON "EbaySellerConfig";
DROP POLICY IF EXISTS "EbaySellerConfig_user_update" ON "EbaySellerConfig";
DROP POLICY IF EXISTS "EbaySellerConfig_user_delete" ON "EbaySellerConfig";
```

After this migration, **all 19 public application tables have RLS enabled with
zero policies.**

## 2. Why deny-all is intentional

The application never reaches its tables through a Supabase `authenticated` or
`anon` client. Verified across the whole codebase:

- There are **zero** Supabase table queries (`.from("<table>")`) anywhere.
- The Supabase anon/authenticated client is used **only for auth** (`getSession`,
  `onAuthStateChange`, `signInWithOtp`, `updateUser`).
- The Supabase service-role client is used **only for Storage** (`.storage`).
- All relational CRUD goes through **Prisma** using the `resale_app` role, which
  has **`BYPASSRLS`**. Row ownership is enforced in application code via
  `sellerId/userId = auth.uid()` `WHERE` filters, not by policies.

Therefore no `authenticated`/`anon` permission is justified by the code. RLS with
no policy denies those roles by default, so a row can never leak cross-user even
if a client query were ever introduced, while `resale_app` continues to operate
unchanged. Dropping the eBay policies is **strictly more restrictive** than the
prior state (an authenticated user can no longer read even their own
encrypted-token rows) and makes every table consistent.

## 3. Pre-apply checks

Run in the Supabase SQL Editor. Do **not** proceed if any expectation fails.

```sql
-- (a) resale_app must bypass RLS, or deny-all would break the backend.
--     Expect: true.
select rolbypassrls
from pg_roles
where rolname = 'resale_app';

-- (b) CompSearchRun must exist and currently have RLS DISABLED.
--     Expect: relrowsecurity = false.
select relname, relrowsecurity
from pg_class
where oid = 'public."CompSearchRun"'::regclass;

-- (c) The 8 eBay policies should currently exist (so the DROP has an effect).
--     Expect: 8 rows.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('MarketplaceConnection', 'EbaySellerConfig')
order by tablename, policyname;

-- (d) This migration must not already be recorded.
--     Expect: 0 rows.
select migration_name, finished_at, rolled_back_at
from "_prisma_migrations"
where migration_name = '20260625000000_rls_least_privilege_hardening';

-- (e) resale_app must retain table privileges (sanity).
--     Expect: all true.
select
  has_table_privilege('resale_app', 'public."CompSearchRun"', 'SELECT')          as csr_select,
  has_table_privilege('resale_app', 'public."MarketplaceConnection"', 'SELECT')  as mc_select,
  has_table_privilege('resale_app', 'public."EbaySellerConfig"', 'SELECT')       as esc_select;
```

## 4. Apply command / options

Preferred (from an environment with a DDL-capable database connection):

```bash
npx prisma migrate deploy
```

`migrate deploy` applies the SQL and records Prisma migration history together.
Keep runtime credentials on the `resale_app` role; do **not** switch the app to
the `postgres` owner account.

Alternative (Supabase SQL Editor, which connects as `postgres`), matching the
manual workflow in `SUPABASE_MIGRATION_PLAN.md` — wrap the migration SQL in a
transaction and reconcile Prisma history afterward:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Paste the exact contents of migration.sql here.

commit;
```

```bash
# Reconcile Prisma history only if SQL Editor was used.
npx prisma migrate resolve --applied 20260625000000_rls_least_privilege_hardening
npx prisma migrate status
```

Do not use `prisma migrate dev` or `prisma migrate reset` against production-like
data.

## 5. Post-apply SQL verification

```sql
-- (a) CompSearchRun now has RLS enabled.  Expect: relrowsecurity = true.
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public."CompSearchRun"'::regclass;

-- (b) Every public application table has RLS enabled.  Expect: 0 rows.
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname <> '_prisma_migrations'
  and c.relrowsecurity = false
order by c.relname;

-- (c) No policies remain on the public application schema (see section 6).
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- (d) resale_app still bypasses RLS and keeps privileges.  Expect: all true.
select
  (select rolbypassrls from pg_roles where rolname = 'resale_app')           as resale_app_bypasses_rls,
  has_table_privilege('resale_app', 'public."CompSearchRun"', 'SELECT')      as csr_select,
  has_table_privilege('resale_app', 'public."CompSearchRun"', 'INSERT')      as csr_insert;
```

## 6. Expected `pg_policies` result

After applying, query (c) above must return **0 rows for the public application
tables**. The deny-all posture means no table in the `public` schema carries any
RLS policy; client roles (`authenticated`/`anon`) are denied by default and the
backend operates through `resale_app` (`BYPASSRLS`).

(Policies that live in Supabase-managed schemas such as `storage`, `auth`, or
`realtime` are unrelated and out of scope; the query above is filtered to
`schemaname = 'public'`.)

## 7. Expected Supabase Security Advisor result

- **`rls_disabled_in_public`: cleared.** All 19 public application tables have RLS
  enabled (this previously flagged `CompSearchRun`).
- **`rls_enabled_no_policy`: may remain as INFO** for the deny-all tables. This is
  the intended state, not a security error — it simply notes that a table has RLS
  on with no policies, so it is inaccessible to client roles.
- `policy_exists_rls_disabled`: none. `auth_rls_initplan` (performance): none
  remain, since the only `auth.uid()` policies have been dropped.

The Security Advisor security checks should pass clean.

## 8. Rollback

Rollback is **not recommended.** Deny-all cannot break the application: the
backend uses `resale_app`, which bypasses RLS, and no code path uses the
`authenticated`/`anon` roles to query tables. Roll back **only** if an unforeseen
production breakage is traced directly to this change.

Do **not** roll back the `CompSearchRun` RLS enablement — disabling it would
reintroduce the `rls_disabled_in_public` Advisor finding and leave one table
inconsistent with the rest.

If (and only if) the eBay policies must be restored, re-create them in the
advisor-correct `(select auth.uid())` form (matching
`20260606030000_fix_ebay_advisor_findings`). RLS is already enabled on these
tables, so only the policies are re-created:

```sql
-- Restore MarketplaceConnection owner-scoped policies.
CREATE POLICY "MarketplaceConnection_user_select" ON "MarketplaceConnection"
  FOR SELECT TO authenticated USING ("userId" = (select auth.uid()));
CREATE POLICY "MarketplaceConnection_user_insert" ON "MarketplaceConnection"
  FOR INSERT TO authenticated WITH CHECK ("userId" = (select auth.uid()));
CREATE POLICY "MarketplaceConnection_user_update" ON "MarketplaceConnection"
  FOR UPDATE TO authenticated
  USING ("userId" = (select auth.uid())) WITH CHECK ("userId" = (select auth.uid()));
CREATE POLICY "MarketplaceConnection_user_delete" ON "MarketplaceConnection"
  FOR DELETE TO authenticated USING ("userId" = (select auth.uid()));

-- Restore EbaySellerConfig owner-scoped policies.
CREATE POLICY "EbaySellerConfig_user_select" ON "EbaySellerConfig"
  FOR SELECT TO authenticated USING ("userId" = (select auth.uid()));
CREATE POLICY "EbaySellerConfig_user_insert" ON "EbaySellerConfig"
  FOR INSERT TO authenticated WITH CHECK ("userId" = (select auth.uid()));
CREATE POLICY "EbaySellerConfig_user_update" ON "EbaySellerConfig"
  FOR UPDATE TO authenticated
  USING ("userId" = (select auth.uid())) WITH CHECK ("userId" = (select auth.uid()));
CREATE POLICY "EbaySellerConfig_user_delete" ON "EbaySellerConfig"
  FOR DELETE TO authenticated USING ("userId" = (select auth.uid()));
```

If Prisma migration history was recorded and the change is being fully reverted,
also remove the history row:

```sql
delete from "_prisma_migrations"
where migration_name = '20260625000000_rls_least_privilege_hardening';
```
