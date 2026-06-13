# Reconciliation Plan: `feature/ebay-required-aspects` + PriceComp v2 → production

**Status:** DRAFT. No branches merged, nothing deployed. This plan exists because PriceComp v2
was promoted to `main` and its prod DB migration applied, but production is actually serving
`feature/ebay-required-aspects` (`78009c3`), which `main` does not contain. Deploying `main` as-is
would roll back live eBay work. This plan reconciles both lines safely.

**Goal:** Get one branch that contains BOTH the eBay-required-aspects work AND PriceComp v2, with the
production DB migrated consistently, then deploy it to production without regressions.

---

## 1. Branch graph / commit relationships

```
                                   1cc2dc6  ("docs: HANDOFF listing intelligence")
                                   = shared merge-base of develop and feature/ebay-required-aspects
                                      │
        ┌─────────────────────────────┴───────────────────────────────┐
        │ develop (PriceComp v2)                                        │ feature/ebay-required-aspects (eBay)
        │  5fcc7ec  Upgrade PriceComp pricing comps architecture        │  839db9d  ebay required aspects readiness
        │  cd9c998  comps: auth before parse (PATCH)                    │  2a8c64a  guarded eBay production publish foundation
        │  f52b60b  Merge PR #28                                        │  78009c3  Make eBay quantity default explicit  ← LIVE in prod
        │  3949215  docs: HANDOFF                                       │            (Vercel dpl_BB7eRKiHMqKZ..., target production, READY)
        │  <this>   docs: HANDOFF held-state + this plan                │
        │     │                                                         │
        │     └── main @ 1a80b5e  "Promote develop -> main: PriceComp v2"   (has PriceComp v2; NOT deployed; Vercel build CANCELED)
```

Merge-bases (verified):
- `merge-base(main, develop)` = `3949215` → **`main` fully contains `develop`** (clean, just promoted).
- `merge-base(develop, feature/ebay-required-aspects)` = `1cc2dc6`.
- `merge-base(main, feature/ebay-required-aspects)` = `1cc2dc6`.

Current SHAs: `origin/main` `1a80b5e` · `origin/develop` `3949215` · `origin/feature/ebay-required-aspects` `78009c3`.

---

## 2. Migrations unique to each line

**Unique to `feature/ebay-required-aspects` (NOT in main/develop):**
- `20260612010000_guarded_ebay_production_publish` — additive + index swap:
  `ALTER TABLE "MarketplaceListing" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'sandbox'`;
  `DROP INDEX MarketplaceListing_inventoryItemId_marketplace_key`;
  `CREATE UNIQUE INDEX ...(inventoryItemId, marketplace, environment)`;
  `CREATE INDEX ...(marketplace, environment, status)`;
  `ALTER TABLE "PublishAttempt" ADD COLUMN "idempotencyKey" TEXT` + its index.
- `20260613010000_backfill_ebay_quantity` — **data migration** (no schema change): `UPDATE "ListingDraft"`
  to ensure `marketplaceDrafts.ebay.quantity` is set (defaults to 1) for eBay-selected drafts. Idempotent.

**Unique to `develop`/`main` (PriceComp v2):**
- `20260613020000_price_comp_v2_fields` — additive: `CompSourceType`/`CompStatus` enums + new `PriceComp`
  columns. **Already applied + verified on the prod DB.**

**Timestamp ordering after merge (lexicographic = apply order):**
`...20260609120000_add_draft_measurements_flaws` → `20260612010000_guarded_ebay...` →
`20260613010000_backfill_ebay_quantity` → `20260613020000_price_comp_v2_fields`. Consistent; no rename needed.

**Prod DB reality (from `prisma migrate status` on develop = "up to date", 9 migrations):** the DB has the
8 base + `price_comp_v2`. The two eBay migrations are **NOT recorded as applied**. This is the central
risk to verify (see §6 step 1): if `78009c3` is genuinely live, it expects `MarketplaceListing.environment`,
which migration 1 adds — so either those migrations were applied out-of-band, or the live app tolerates
their absence, or production is not actually `78009c3`. Resolve before deploying.

---

## 3. Files unique to each line (since base `1cc2dc6`)

**eBay-only (no PriceComp overlap):** `.env.example`, the 2 eBay migrations,
`src/app/(app)/inventory/[id]/page.tsx`, `src/app/api/listings/[id]/ebay-preflight/route.test.ts`,
`src/app/api/listings/draft/[draftId]/route.ts` (+ `route.persist.test.ts`),
`src/app/api/listings/publish/route.test.ts`, `src/components/app/ebay-preflight-card.tsx`,
`src/components/app/publish-modal.tsx` (+ `.test.tsx`), `src/lib/api/client.ts`,
`src/lib/listing-draft-update.ts` (+ `.test.ts`), `src/lib/listing/ebay-aspects.ts` (+ `.test.ts`),
`src/lib/marketplace/adapters/ebay/*` (client/config/listing-readiness/preflight/publish + tests),
`src/lib/marketplace/publish-handler.ts` (+ `.test.ts`), `src/lib/view/server-map.ts` (+ `.test.ts`),
`src/lib/view/types.ts`.

**PriceComp-v2-only (no eBay overlap):** `docs/superpowers/plans/2026-06-12-price-comp-v2.md`,
`prisma/migrations/20260613020000_price_comp_v2_fields/migration.sql`,
`prisma/migrations/price-comp-v2.test.ts`,
`src/app/api/listings/comps/[compId]/route.ts` (+ `.test.ts`),
`src/app/api/listings/comps/route.ts`, `src/app/comps-panel.tsx` (+ `.test.tsx`),
`src/app/comps-pricing-view.tsx`, `src/lib/comps/normalize.ts`, `src/lib/comps/registry.ts`,
`src/lib/comps/sources/{apify-ebay-sold,grailed-sold,poshmark-sold,depop-active,google-lens}.ts`
(+ `stubs.test.ts`), `src/lib/pricing/{comps,price-comp-input,summarize}.ts` (+ tests),
`src/test/fixtures/resale.ts`.

**Touched by BOTH:** `prisma/schema.prisma`, `HANDOFF.md`.

---

## 4. Likely conflict areas

A `git merge-tree --write-tree develop feature/ebay-required-aspects` returned **exit 0 — zero conflicts**
(disjoint hunks even in the two shared files). So mechanically the merge is clean. Watch these anyway:

- **`prisma/schema.prisma`** — auto-merges (PriceComp added `CompSourceType`/`CompStatus` enums + `PriceComp`
  fields; eBay added `MarketplaceListing.environment` + `PublishAttempt.idempotencyKey` — different model
  blocks). **MUST** run `npx prisma validate` (and `npx prisma format`) after merge; a clean text merge can
  still yield a semantically wrong schema. Confirm the merged `MarketplaceListing`/`PublishAttempt` models
  match eBay-migration 1, and `PriceComp` matches the v2 migration.
- **`HANDOFF.md`** — both edit the top. `merge-tree` says clean today, but the held-state docs commit added
  by THIS plan changes develop's top region, so a textual conflict may appear at merge time. Trivial:
  keep all dated entries, newest first.
- **No other overlaps.** All eBay vs PriceComp code/test files are disjoint, so the combined test suite
  should be ≈ the union (expect ~ develop's 357 + eBay's net-new tests).

---

## 5. Safest merge order

**Recommended: bring eBay into the integration branch (`develop`), then promote.** This matches the repo flow
(`feature/* → develop → main`); `feature/ebay-required-aspects` was deployed-from-branch but never integrated.

1. `git checkout develop && git pull` (at `3949215` + the held-state docs commit).
2. `git checkout -b reconcile/ebay-into-develop`.
3. `git merge origin/feature/ebay-required-aspects`.
   - Resolve `HANDOFF.md` if it conflicts (keep all entries).
   - `npx prisma format && npx prisma validate` — confirm the merged schema is valid and reflects all three
     migrations' end-state.
4. Gate: `npm run lint && npx tsc --noEmit && npm test && npx prisma validate && npm run build`.
5. Open PR `reconcile/ebay-into-develop` → `develop`; review (CodeRabbit), merge.
6. Promote `develop` → `main` (`git merge --no-ff`, "Promote develop -> main: eBay aspects + PriceComp v2").
7. Apply DB migrations to prod (§6), THEN deploy (§7). Do NOT deploy before the DB step.

Do NOT merge `develop` into `feature/ebay-required-aspects` (wrong direction; would leave the integrated
result off the mainline).

---

## 6. Exact DB migration plan (production)

Prod already has `price_comp_v2` applied; the two eBay migrations are pending there.

1. **Verify ground truth first.** From the reconciled branch, against prod:
   `! npx prisma migrate status`. EXPECT: exactly `20260612010000_guarded_ebay_production_publish` and
   `20260613010000_backfill_ebay_quantity` reported as not-yet-applied, nothing else. If it instead reports
   them as already applied, or reports drift / unknown migrations, **STOP** — that reveals what `78009c3`
   actually did to prod, and changes the plan.
2. **Pre-checks for migration 1 (index swap):** existing `MarketplaceListing` rows all get
   `environment='sandbox'` (column default), so the new unique index `(inventoryItemId, marketplace,
   environment)` is at least as permissive as the dropped `(inventoryItemId, marketplace)` — no new unique
   collisions. Safe. (If any duplicate `(inventoryItemId, marketplace)` rows already exist, the OLD unique
   index would already have prevented them, so none can exist.)
3. **Apply:** `! npm run db:deploy`. Prisma applies the two pending eBay migrations in filename order
   (`...12010000` then `...13010000`); `price_comp_v2` is already recorded and is skipped. `migrate deploy`
   applies any unrecorded migration regardless of timestamp, and the two eBay migrations touch
   `MarketplaceListing`/`PublishAttempt`/`ListingDraft` — disjoint from `PriceComp` — so out-of-natural-order
   application is safe.
4. **Verify:** `! npx prisma migrate status` → "Database schema is up to date!" (10 migrations).

Owner runs these via the `!` prefix (the harness blocks the agent from loading `.env.local` secrets, and
`DIRECT_URL` has IPv6/DNS issues on this machine).

---

## 7. Exact deploy plan (production)

`git push` to `main` does NOT auto-deploy here (ignored-build-step cancels the webhook build). Production
deploys are explicit.

1. Only after §6 succeeds and the gate is green on the reconciled `main`:
   `vercel --prod` (or the `vercel:deploy` skill with arg `prod`) from the repo root, targeting the
   `jaky/resale-crosslister` project (`prj_m0godHHGQwmhjCvvqQB9SUJyyAb5`, team `team_PyRZqoI0WGhS4RybAKnWdIpQ`).
2. Confirm via Vercel API (`list_deployments` / `get_deployment`): newest deployment has the reconciled
   `main` `githubCommitSha`, `target: production`, `state: READY`, and holds the `sello.wtf` alias. Report
   the deployment URL + the `main` commit hash.
3. **Smoke test sello.wtf** — read-only first: site loads; existing listings load; listing editor renders;
   comps panel renders; legacy/manual comps calculate without error. Then, with Chrome signed in as the
   owner, writes against a clearly-labeled throwaway comp (delete it after): add comp, edit comp, delete
   comp, status selector, platform selector, use-in-pricing toggle, ignore-outlier toggle, confirm
   median/recommended/quick-sale update.
4. **Rollback path:** if the new deploy misbehaves, Vercel Instant Rollback to the prior READY production
   deploy (`dpl_BB7eRKiHMqKZ...`, `78009c3`). The additive migrations stay applied and are harmless to the
   rolled-back code.

---

## Open questions to settle before executing
- **What is truly live on `sello.wtf`, and are the two eBay migrations actually applied to prod?** The
  develop `migrate status` says they are not. If `78009c3` is live and depends on `MarketplaceListing.environment`
  without that column existing, production may already be inconsistent — investigate first (§6 step 1).
- Confirm `feature/ebay-required-aspects` is the intended source of the live eBay work (vs. an
  uncommitted/owner-side variant).
