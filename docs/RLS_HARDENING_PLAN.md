# App-table RLS hardening plan (Finding 6)

Status: **PLAN ONLY — not implemented.** Drafted during the security-hardening
pass. Enabling RLS broadly touches every data table and must not be applied in an
unattended run. This document is the design for a future, supervised migration.

## Why this is defense-in-depth, not a live vulnerability

- Row Level Security is currently enabled only on `MarketplaceConnection` and
  `EbaySellerConfig` (the encrypted eBay token tables) — see
  `20260531000000_enable_ebay_connection_rls` and
  `20260606030000_fix_ebay_advisor_findings`.
- The browser only ever uses the Supabase **anon** key for auth
  (`signInWithOtp` / `getSession` / `onAuthStateChange` / `updateUser`). There are
  **no** `supabase.from('<table>')` data reads/writes anywhere in `src/`.
- All tenant data flows through server-side Prisma over `DATABASE_URL` (the
  `resale_app` role), and every query is already scoped by `sellerId` (directly or
  via the `inventoryItem` relation).

So the remaining tables are protected by the application layer today. RLS adds a
second, database-enforced boundary in case a future client-side Supabase data
query (or a service misconfiguration) is ever introduced.

## Critical pre-condition (verify BEFORE applying)

Enabling RLS on a table blocks all access for roles that are **not** the table
owner and do **not** have `BYPASSRLS`, unless a permissive policy matches. The app
connects as `resale_app`. The existing eBay-connection tables already have RLS
enabled **and** the publish/delist flow reads/writes `MarketplaceConnection` as
`resale_app` successfully — which means `resale_app` already bypasses RLS (it is
either the table owner or has the `BYPASSRLS` attribute).

Confirm this is true for the data tables too before applying, e.g.:

```sql
-- resale_app must be BYPASSRLS or the owner of every table we touch.
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'resale_app';
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
```

If `resale_app` is **not** BYPASSRLS and **not** the owner, do **not** apply the
migration as written: it would break the app's reads/writes. In that case add a
permissive policy for `resale_app` (or grant `BYPASSRLS`) first.

## Tables affected and ownership path

| Table | Ownership path to the seller | Policy predicate (for `authenticated`) |
|---|---|---|
| `InventoryItem` | `sellerId` directly | `sellerId = auth.uid()` |
| `ItemPhoto` | `inventoryItemId` → `InventoryItem.sellerId` | `EXISTS (SELECT 1 FROM "InventoryItem" i WHERE i.id = "inventoryItemId" AND i."sellerId" = auth.uid())` |
| `AiOutput` | `inventoryItemId` → `InventoryItem.sellerId` | same EXISTS shape |
| `ListingDraft` | `inventoryItemId` → `InventoryItem.sellerId` | same EXISTS shape |
| `PriceComp` | `inventoryItemId` → `InventoryItem.sellerId` | same EXISTS shape |
| `CompSearchRun` | `inventoryItemId` → `InventoryItem.sellerId` | same EXISTS shape |
| `MarketplaceListing` | `inventoryItemId` → `InventoryItem.sellerId` | same EXISTS shape |
| `PublishAttempt` | `marketplaceListingId` → `MarketplaceListing` → `InventoryItem.sellerId` | two-level EXISTS join |
| `MarketplaceEvent` | `marketplaceListingId` → `MarketplaceListing` → `InventoryItem.sellerId` | two-level EXISTS join |
| `JobLog` | `inventoryItemId` is **nullable** (compliance rows have NULL) | see note below |
| `MarketplaceConnection` | already has RLS (`userId = auth.uid()`) | no change |
| `EbaySellerConfig` | already has RLS (`userId = auth.uid()`) | no change |

`JobLog` note: rows written by the compliance webhook have `inventoryItemId =
NULL` and belong to no seller. Policy: `authenticated` may read a `JobLog` row only
when it has a non-null `inventoryItemId` owned by the caller; NULL-owner system
rows are never exposed to `authenticated` (they are written/read only server-side
by `resale_app`). Predicate: `"inventoryItemId" IS NOT NULL AND EXISTS (... owned)`.

## Expected behavior by role

- **anon** (logged-out Supabase client): no policy matches → no rows. Correct.
- **authenticated** (Supabase client + user JWT): sees/mutates only its own rows
  via the predicates above.
- **resale_app** (the app's Prisma runtime): bypasses RLS (see pre-condition) →
  unchanged behavior. This is the key reason the change is non-breaking.
- **service role / postgres**: bypasses RLS → unchanged.

## Migration approach

- One new timestamped migration, raw SQL (RLS policies are not expressible in the
  Prisma schema; this matches the existing eBay-RLS migrations).
- For each table: `ALTER TABLE "<T>" ENABLE ROW LEVEL SECURITY;` then one
  `CREATE POLICY` per operation set. Prefer the `(select auth.uid())` form inside
  predicates (per the `20260606030000_fix_ebay_advisor_findings` Supabase advisor
  fix) so the function is evaluated once per query, not per row.
- Use `FOR ALL` with both `USING` (read/update/delete visibility) and
  `WITH CHECK` (insert/update authorization) where a single policy suffices, or
  split per command to mirror the existing connection policies.
- Do **not** add `FORCE ROW LEVEL SECURITY` (that would also subject the table
  owner to RLS and risk breaking `resale_app`).

Example (one direct, one relational):

```sql
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "InventoryItem_user_all" ON "InventoryItem"
  FOR ALL TO authenticated
  USING ("sellerId" = (select auth.uid()))
  WITH CHECK ("sellerId" = (select auth.uid()));

ALTER TABLE "PriceComp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PriceComp_user_all" ON "PriceComp"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "InventoryItem" i
                 WHERE i.id = "PriceComp"."inventoryItemId"
                   AND i."sellerId" = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM "InventoryItem" i
                      WHERE i.id = "PriceComp"."inventoryItemId"
                        AND i."sellerId" = (select auth.uid())));
```

## Rollback plan

Each table is independently reversible:

```sql
DROP POLICY IF EXISTS "<Table>_user_all" ON "<Table>";
ALTER TABLE "<Table>" DISABLE ROW LEVEL SECURITY;
```

Because `resale_app` bypasses RLS, neither enabling nor disabling changes app
behavior, so rollback is low-risk. Keep the down steps in the PR description.

## Test plan

1. **Static migration test** (mirrors `prisma/migrations/ebay-rls.test.ts`): assert
   the new `migration.sql` enables RLS and creates a policy for every table above,
   uses `(select auth.uid())`, and never uses `FORCE ROW LEVEL SECURITY`.
2. **Manual DB verification** (staging/preview Supabase, supervised):
   - As `resale_app`: existing app flows (list, draft, publish, comps) still
     read/write — proves bypass is intact.
   - As `authenticated` user A: can select only A's rows; cannot select/update/
     delete user B's `InventoryItem`, `ListingDraft`, `PriceComp`,
     `MarketplaceListing`, `PublishAttempt`, `MarketplaceEvent`.
   - As `authenticated`: cannot see NULL-owner `JobLog` compliance rows.
   - As `anon`: zero rows from every table.
3. Run the full app gate (`lint`, `test`, `tsc`, `build`) — these are unaffected
   since the app uses `resale_app`.

## Recommended sequencing

Apply on a preview/staging Supabase first, run the manual verification matrix,
then schedule the production migration in a supervised window. Not required for
the current threat model; do it as planned hardening.
