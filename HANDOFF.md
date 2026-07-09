# HANDOFF

Living handoff doc. Agents: read this at session start; update before finishing.
Never put secrets here. Canonical repo: `~/dev/resale-crosslister-clean`.

Older session history: `docs/history/HANDOFF-archive-2026-07-09.md`.

## Last updated
2026-07-09 — Cursor. Repo hygiene: archived Desktop no-git checkout, symlinked
`perc 30/resale-crosslister` → clean repo, TypeScript 7 dual setup, safe dep
bumps, admin hide-surface test fixes, Clerk research (stay on Supabase+Stripe).
Branch: `chore/repo-hygiene-2026-07-09`.

## Recent work
- Admin users now receive all feature entitlements (paidComps/publish/etsy) so owner testing is not blocked by separate allowlists. Global kill-switches still apply.
- Added always-on testing policy + full public runthrough notes.
- Neutralized orphan Desktop checkout (`resale-crosslister-ARCHIVED-NO-GIT`).
- Documented Clerk auth/billing research; deferred migration.
- Updated WORKTREES.md / LOCAL_DEVELOPMENT_RULES.md to match real paths.
- Fixed develop tip typecheck (speed-insights install, test fixture types, ioredis pin for BullMQ).
- Full gate green: lint 0 errors, tsc 0, 1415 tests, build 0.

## Current state
- Repo `resale-crosslister`. Production: https://sello.wtf (Vercel project
  `jaky/resale-crosslister`). Current production deployment is
  `dpl_2RdUdBSdV4ewDS9eaFLgf5Rg1fiY` from local commit `10de26a`, aliased to
  `https://sello.wtf`.
- Pricing and billing are now directly discoverable: the public landing page
  links to `/pricing`, the pricing page uses Sello-native styling, the signed-in
  sidebar has a Billing item to `/settings/billing`, and Settings has a Billing
  card with pricing and billing actions.
- The signed-in billing page now uses the same Sello app shell/theme primitives
  as the rest of the authenticated UI and follows light/dark mode instead of
  hardcoded neutral/red Tailwind colors.
- Stripe Checkout success and cancel/back returns from the signed-in Billing
  page both land back on `/settings/billing`, not public `/pricing`.
- Billing navigation is warmed from the Sidebar and `/api/billing/usage` now uses
  a compact query shape; Vercel Speed Insights is installed for real-user Web
  Vitals monitoring.
- PR #66 paid-beta bulk visibility and the 2026-07-03 StockX automation pass are
  merged to `develop` and deployed to production. StockX code now supports
  official API catalog-backed create/activate/deactivate through audited publish
  and delist handlers, plus inventory-sync worker delist jobs. A local
  2026-07-04 follow-up adds StockX listing-status reconciliation for pending
  publish operations and sold/inactive detection, plus shared-account scope fixes
  for StockX status sync and adapter-backed delist jobs; this is live in
  production deployment `dpl_7VFFdP6jXEQpncBsPDE784uNYYhZ`.
- PR #65 paid-beta checkout/bulk preflight hardening is also merged and live.
- Stripe live billing is active; production pricing is Free `$0`, Pro `$20/mo`,
  Kingpin `$119/mo`; webhook endpoint is
  `https://sello.wtf/api/billing/webhook`, and invalid signatures return
  `400 INVALID_SIGNATURE`.
- Production DB migration ledger was previously reconciled for
  `20260625010000_add_billing_models`,
  `20260625020000_inventory_account_scope`,
  `20260625030000_marketplace_connections_account_scope`, and
  `20260701010000_stockx_foundation`. PR #66 added no migration.
- StockX production runtime status: Sello-owned StockX envs/flags were generated
  or set on 2026-07-05 and redeployed. Safe callback probe now reaches
  `STOCKX_OAUTH_STATE_INVALID`, which confirms config is past the disabled-env
  blocker. Signed-in Connect StockX is currently blocked by account eligibility:
  `Your plan allows 1 connected marketplace. Upgrade to connect more.` Keep
  `STOCKX_LISTING_ENABLED=false` until OAuth, exact product/variant readiness,
  and one-item operator approval are complete.
- PR #36 marketplace-image migration
  `20260617120000_add_marketplace_images` is applied in production and Prisma
  migration status is up to date.
- PR #37 Full Auto Price Comps is merged, promoted, and live. Production
  manual Refresh comps validated successfully against Apify eBay sold comps.
  Draft auto-discovery also validated, but was disabled afterward because the
  observed Apify cost was about `$0.3641` for one draft run and quality was only
  possible-match level while reporting high confidence. Manual Refresh remains
  enabled.
- Production eBay OAuth/readiness and guarded live publish path are working.
  `EBAY_PRODUCTION_PUBLISH_ENABLED` is currently absent from Vercel Production,
  so production publish is blocked/hidden again by default.
- First policy-safe Sello live eBay publish succeeded on item
  `7d70b619-c473-40ca-b601-1a3956161862`, then duplicate publish was rejected
  with typed 409, the listing was ended, ended offer/inventory artifacts were
  cleaned, and the final eBay scan was clean.
- Cleanup scanner fix is live: ended/unpublished offers are cleanup candidates;
  only `PUBLISHED` offers or `ACTIVE` listing status count as live.
- PR #35 stabilization is deployed: master lifecycle sync is fixed for eBay
  publish/delist, passive detail loads no longer trigger external comp provider
  fetches, and obvious unsafe eBay non-sale wording is blocked in readiness.
- `EBAY_PUBLIC_IMAGE_BUCKET` is configured in Vercel Production as
  `sello-ebay-public-listing-photos`. The bucket has public read, server/service
  writes, and production preflight created a public derivative from a private
  original photo. Live eBay publish is still disabled because
  `EBAY_PRODUCTION_PUBLISH_ENABLED` remains absent.

## Shipped to prod (all live now)
- Full app UI, Phase 0, Full Auto Price Comps with Apify eBay sold provider
  (manual Refresh enabled; draft auto-discovery enabled only for strong
  identity items under strict Apify caps).
- T1–T7 (lifecycle mark-sold/delist, responsive layout, auto-fetch comps, inventory
  grid/sort/pagination, photo set-cover, consistent loading/error states, tests).
- eBay account-deletion compliance endpoint (deployed, but **env not set yet** — see Blocked).

## Recent work (newest first)
- 2026-06-17 (Codex): reviewed, merged, and deployed PR #38 Comp Cost +
  Confidence Hardening. PR merge commit `507a91e`; final main commit
  `908bded`; final production deployment
  `dpl_J9X8eo53dH1muXsjGfucyvciKUGe` is READY and aliased to `sello.wtf`.
  Gates passed on PR branch and main: prisma format/validate, lint (same two
  existing warnings in `draft-actions.test.ts`), tsc, 571 tests, build, migrate
  status. No migration added. Final production env: `COMPS_AUTO_DISCOVERY_ENABLED=true`,
  `COMPS_APIFY_EBAY_SOLD_ENABLED=true`, `COMPS_MAX_PROVIDER_RESULTS=10`,
  `COMPS_MAX_QUERY_VARIANTS=1`, `COMPS_AUTO_MIN_IDENTITY_CONFIDENCE=0.85`,
  `COMPS_REFRESH_COOLDOWN_SECONDS=60`, `COMPS_EBAY_ACTIVE_ENABLED=false`,
  `COMPS_SERPAPI_EBAY_ACTIVE_ENABLED=false`, and
  `EBAY_PRODUCTION_PUBLISH_ENABLED` absent. Production validation: generic
  black shirt `7d70b619-c473-40ca-b601-1a3956161862` skipped with
  `skipped_weak_identity`, zero provider calls, and one query; branded North
  Face item `9fa01f5b-77f6-4594-87fd-ef701d64564d` ran Apify with final caps
  (10 fetched / 6 accepted / 4 rejected), medium confidence, recommended price
  `13146` cents, cooldown visible in UI, and passive dashboard/inventory/detail
  navigation created no extra runs. Apify run cost stayed high at about
  `$0.3201` even with `maxItems=10` (previous same-day reference `$0.3641`),
  so auto-discovery remains enabled only because the identity gate is now
  strict; monitor spend closely. Chrome file upload permission blocked a fresh
  new-photo AI draft validation, so the auto path was validated by controlled
  production-backed `runCompFetch` calls rather than a new uploaded item. Vercel
  recent log scan found no error/fatal/500/token-like lines.
- 2026-07-05 (Codex): Generated/set Sello-owned StockX Production envs, redeployed
  `dpl_2RdUdBSdV4ewDS9eaFLgf5Rg1fiY`, and proceeded to signed-in StockX Connect
  preflight. Runtime config is no longer disabled: safe callback probe returns
  `400 STOCKX_OAUTH_STATE_INVALID` for fake state instead of
  `STOCKX_NOT_ENABLED`. Signed-in marketplace page shows StockX not connected,
  but Connect StockX returns `403` because the current plan allows only one
  connected marketplace and eBay is already connected. Stopped before OAuth/live
  listing. No secrets printed, no StockX-issued credentials invented, no
  Keychain/cookie extraction, no paid checkout, no bulk action. `.env.example`
  corrected to `STOCKX_API_BASE_URL=https://api.stockx.com/v2`.
- 2026-07-05 (Codex): Ran final live StockX single-item verification preflight
  and stopped safely before OAuth/listing. Local gate passed on `develop`
  (`b2fc862`): Prisma validate, diff check, lint with two known warnings, full
  tests (209 files / 1371 tests), and build. Vercel deployment
  `dpl_7VFFdP6jXEQpncBsPDE784uNYYhZ` remains READY and aliased to
  `https://sello.wtf`. Vercel Production metadata lists required `STOCKX_*`
  names, but redacted temp env pull reported empty/non-boolean StockX values and
  safe runtime callback probe returned `503 STOCKX_NOT_ENABLED`. No StockX OAuth,
  catalog, market data, live publish, detect-status provider call, delist, paid
  checkout, Keychain/cookie/session extraction, or bulk action was run.
- 2026-07-04 (Codex): Fixed the StockX shared-account automation gap found by
  subagent audit and deployed it to production. Commit
  `8f679a9110ee1cfac9453ecb12d25afe4003eaf7`; deployment
  `dpl_7VFFdP6jXEQpncBsPDE784uNYYhZ`, READY and aliased to
  `https://sello.wtf`. Queue-delist payloads now include account scope,
  inventory-sync worker delist/status lookups use account scope when present,
  StockX/eBay delist handlers receive accountId from the worker, and StockX sold
  reconciliation passes the inventory owner into `markItemSold`. Added
  regression tests for shared-account StockX delist/status sync and documented
  StockX env names in `.env.example`. Validation: focused 3-file suite / 53
  tests, `npx prisma validate`, `git diff --check`, lint (two known warnings),
  full `npm test` (209 files / 1371 tests), local build, Vercel build, production
  protected-route smoke, and Vercel log filter. No live StockX provider call,
  listing, deactivate, or bulk action was run.
- 2026-07-04 (Codex): Added StockX listing-status reconciliation in commit
  this commit. The
  StockX client can fetch a stored listing's current status, submitted StockX
  publishes enqueue an idempotent `detect_status` sync job, and the worker now
  executes `detect_status` for StockX while keeping other marketplaces
  fail-closed. Status sync maps active/listed to `LISTED` and completes the
  pending publish attempt, maps sold through `markItemSold`, maps
  inactive/deactivated to `ENDED`, and leaves unknown provider states
  non-terminal. Validation: focused StockX/client/status-sync/publish/worker
  tests (4 files / 76 tests), full `npm test` (209 files / 1367 tests),
  `npm run build`, and `npm run lint` (same two known warnings). No live StockX
  provider call, listing, or deactivate was run.
- 2026-07-03 (Codex): Implemented, validated, pushed, and production-deployed
  StockX full-native automation. Commit `0353eaf` added official API
  create-listing/activate-listing/deactivate plumbing, audited publish/delist
  persistence, duplicate guards, inventory-sync worker StockX delist jobs, and
  seller confirmation UI. Commit `c300b01` fixed marketplace status copy so
  StockX no longer appears as draft-only/no-sync when the API config is present.
  Deployment `dpl_9wySr8qrtFHA5E6GJawKVzKSGdEh` is READY on `https://sello.wtf`.
  Validation: focused StockX/delist/queue/UI/jobs tests, full `npm test` (208
  files / 1360 tests), `npm run lint` (two known warnings), `npm run build`,
  `git diff --check`, production public/protected smoke, signed-in `/channels`
  smoke, and Vercel error-log filter. Live StockX listing smoke did not run
  because production StockX env variable values are empty.
- 2026-07-02 (Codex): Shipped the performance/navigation polish pass. Researched
  current Next/Vercel guidance around prefetching, streaming/loading UI,
  production-safe motion, and Speed Insights. Implemented billing data prefetch
  and short-lived cache, optimized `/api/billing/usage` to one subscription read
  plus one usage-counter read, added a Billing skeleton, added smooth Sello
  route/nav/card/progress transitions with reduced-motion support, and wired
  `@vercel/speed-insights`. Commit
  `977fe7ccf891b98d95b3bb8ecb72f8926f198708` deployed as
  `dpl_77sDj5cK3VhkLyH25xp6zBWnGU6J`, READY and aliased to `https://sello.wtf`.
  Full local gate passed (`npx prisma validate`, lint with two known warnings,
  204 test files / 1322 tests, build, diff checks). Live smoke verified `/`,
  `/pricing`, and `/settings/billing` 200, anonymous checkout protected with
  401, no leak patterns, no error/fatal/500 logs, and signed-in Billing rendered
  real plan/usage content in Chrome. Chrome automation did not reliably complete
  Dashboard -> Billing click-through before final. No real paid checkout or
  marketplace publish.
- 2026-07-02 (Codex): Fixed Billing -> Upgrade -> Stripe cancel/back returning
  to the public pricing page. Root cause was a hardcoded checkout `cancel_url`
  of `/pricing`; it now returns to `/settings/billing?status=cancelled`, with
  the route test asserting exact success/cancel URLs. Commit
  `cf67ea19a5b6ed95e37d971ea5df43ad18040cf2` deployed as
  `dpl_6FiE5HiLunbDx8L9v1R5hJ6bK3yr`, READY and aliased to `https://sello.wtf`.
  Full local gate passed (`npx prisma validate`, lint with two known warnings,
  203 test files / 1320 tests, build, diff checks). Live smoke verified `/`,
  `/pricing`, and `/settings/billing` 200, anonymous checkout protected with
  401, no leak patterns, and no error logs for the deployment. No real paid
  checkout or marketplace publish.
- 2026-07-02 (Codex): Fixed the signed-in `/settings/billing` visual mismatch
  after live dark-mode review showed near black-on-black hardcoded styling. The
  page now uses Sello `Topbar`, `page`, `card`, `badge`, `Btn`, `Banner`, and
  typography primitives, and a source-level style regression test prevents the
  old hardcoded `text-neutral-*`, `border-neutral-*`, `bg-red-*`, and
  `text-red-*` classes from returning. Commit
  `03944265bf2e59628bb6c0f0af7a81f1f22d7af7` deployed as
  `dpl_DLGZtZgMSsfmuLhWMBAQLqfWK419`, READY and aliased to `https://sello.wtf`.
  Full local gate passed (`npx prisma validate`, lint with two known warnings,
  203 test files / 1320 tests, build, diff checks). Live smoke verified `/`,
  `/pricing`, and `/settings/billing` 200 and no error/fatal/500 logs for the
  deployment. No real paid checkout or marketplace publish.
- 2026-07-02 (Codex): Fixed hidden pricing/billing navigation and deployed it to
  production. Public landing now links to `/pricing` from nav, hero, pricing
  section, and footer; signed-in app sidebar has a direct Billing item; Settings
  has a Billing card; pricing cards and usage meters use the Sello token/card/
  button system instead of generic neutral styling. Commit
  `ace19ee7c8c84fcac9aaafd240958d14325765d7` deployed as
  `dpl_VcR6i2Hcvi9tFQijA8CLJyJixoQC`, READY and aliased to `https://sello.wtf`.
  Full local gate passed (`npx prisma validate`, lint with two known warnings,
  202 test files / 1319 tests, build, diff checks). Live smoke verified `/` and
  `/pricing` 200 with the new links, protected anonymous billing APIs still 401,
  no leak patterns, no production screenshot overflow, and no error/fatal/500
  logs for the deployment. No real paid checkout or marketplace publish.
- 2026-07-01 PDT / 2026-07-02 UTC (Codex): Finished PR #66,
  `https://github.com/g4m35/resale-crosslister/pull/66`. Rebased on
  `origin/develop`, ran the full local gate, found one strict-review blocker,
  added a red test, fixed bulk delist preflight to enforce the active account
  plan cap before preflight work, reran focused and full gates, pushed
  `53d2500`, re-triggered CodeRabbit, merged PR #66, and deployed production
  deployment `dpl_AmqE2rKjaVS66uJcsRzW7XdLBxs1` to `https://sello.wtf`.
  Production smoke was non-destructive: `/pricing`, `/settings/marketplaces`,
  `/inventory`, and `/channels` returned 200; anonymous checkout/portal/bulk/
  marketplace routes stayed protected; invalid Stripe webhook returned
  `400 INVALID_SIGNATURE`; StockX publish returned
  `503 STOCKX_LISTING_NOT_ENABLED`; and error/fatal/500 log filters for the new
  deployment found no records. No live paid checkout, marketplace publish, StockX
  live listing creation, bulk StockX publishing, env changes, or secrets.
- 2026-07-01 (Codex): Started
  `feature/stockx-automation-paid-beta-flow` (NOT merged, NOT deployed) after
  pushing the prior HANDOFF-only `develop` commit. Added plan/limit data to the
  authenticated capabilities response, fail-closed Free limits in the client
  provider, visible bulk limits in inventory + publish/delist modals, and
  over-limit bulk action blocking before any bulk preflight/execute. Tightened
  StockX capability resolution so flags alone no longer expose connect/catalog/
  market-data readiness; status skips connection lookup until OAuth config is
  complete, catalog/market data require API config, and listing placeholder
  requires full API config plus the listing flag. Added tests for capabilities,
  provider fail-closed limits, bulk publish/delist limit copy, StockX config
  readiness, capability matrix, status route, and publish placeholder env.
  Validation: `npx prisma validate`; `npm run lint` (2 known warnings only);
  `npm test` 201 files / 1317 tests; `npm run build`; `git diff --check`;
  forbidden-file and secret-pattern scans clean. `npx prisma migrate status`
  blocked locally by absent datasource URL. Vercel Production StockX env names
  present; Preview `develop` missing `STOCKX_CLIENT_ID`,
  `STOCKX_CLIENT_SECRET`, and `STOCKX_API_KEY`.
- 2026-07-01 (Codex): Deployed PR #65 to production. Vercel deployment
  `dpl_BnRkExMNcz3ceMJENqWEdFxLuMEe` is READY and aliased to `sello.wtf`;
  deployed commit `557293980d38f22756227245573bc487da86dec1`. Non-destructive
  smoke passed for public pricing, protected anonymous checkout/portal/bulk/
  marketplace routes, invalid Stripe webhook `400 INVALID_SIGNATURE`, StockX
  publish disabled, StockX settings card presence on `/settings/marketplaces`,
  and zero error/fatal/500 logs for the new deployment. Authenticated owner/admin
  checkout-open and member-denial production smoke were not exercised because no
  authenticated seller session/token was available in this thread; covered by
  focused tests instead. No real paid checkout or marketplace publish occurred.
- 2026-07-01 (Codex): Started paid-beta production-flow hardening on
  `feature/paid-beta-production-flow` (NOT merged, NOT deployed). Baseline from
  `develop` matched expected HEAD `f1f307429a6e3a9c7018f40e3ac3edc7b8f70b7c` and
  initial gates passed. Fixed two paid-beta gaps with tests: billing checkout is
  now owner/admin-only before Stripe customer/session creation, and bulk publish
  preflight blocks selections over the account plan cap before eBay readiness
  work. Added StockX config coverage for misnamed env vars being ignored. Focused
  tests were red before implementation for the two behavior fixes, then green.
  Full validation: `npx prisma validate`; `npm run lint` (2 known warnings only);
  `npm test` 199 files / 1308 tests; `npm run build`; `git diff --check`. Diff
  contains no `.env*`, no `LOCAL_DEVELOPMENT_RULES.md`, and secret-pattern scan
  was clean.
- 2026-06-25 (Codex): Continued Phase 4.3 account-scope migration on
  `feature/stripe-billing-metering-seats` (NOT merged, NOT deployed). Migrated
  comps GET/POST, explicit comp refresh, comp `[compId]` update/delete,
  provider-usage, history, jobs, and `runCompFetch` to account scope. Comp refresh
  now checks item ownership with `accountId`, applies account quota on the same
  account object, and passes `accountId` into `runCompFetch`; provider usage uses
  `accountMemberIds(account.id)` so active members share usage visibility while
  revoked/unrelated users are excluded. Verification: `npx tsc --noEmit --pretty
  false`; focused 59-test run for comps/refresh/`[compId]`/provider-usage/history/
  jobs/fetch/fetch-paid-budget; stale seller-filter scan clean for this batch;
  `git diff --check` clean. No env changes, no live calls, no migrations applied.
- 2026-06-25 (Codex): Continued Phase 4.3 account-scope migration on
  `feature/stripe-billing-metering-seats` (NOT merged, NOT deployed). Migrated the
  item-centric seller-data slice to active account scope: inventory detail GET/PATCH
  and `loadItemDetailState`, photos POST/PATCH/DELETE, copy-ready export,
  lifecycle action, bulk price update, CSV import (new rows stamp `accountId`), and
  draft PATCH/POST. Tests now assert account-scoped lookup for detail/export/
  lifecycle; `server-only` route shims added where the billing scope helper is
  imported. Verification: `npx tsc --noEmit --pretty false`; focused 35-test run
  for detail/export/draft/lifecycle/server-map; `npm run lint` 0 errors / 2
  pre-existing warnings; `npx prisma validate`; `git diff --check` clean. No env
  changes, no live calls, no migrations applied.
- 2026-06-25 (Claude): Stripe billing + usage metering + seats, on
  `feature/stripe-billing-metering-seats` (NOT merged, NOT deployed; rebased onto
  current `origin/develop` incl. RLS #60). Spec + phased plan in `docs/superpowers/`.
  **Phases 0-3 complete + Phase 4.1 (seats membership) complete. Gate green: 1092
  tests, lint 0, prisma valid, build 0.**
  - **Phase 0-1 (billing core):** plan catalog (Free $0 / Pro $20 / Kingpin $119,
    `src/lib/billing/plans.ts`), config loader + SDK client, idempotent
    product-sync script, Prisma models (Account, AccountMember, Subscription,
    UsageCounter, StripeEvent) + migration `20260625010000_add_billing_models`
    (**created, NOT applied** — apply via develop), account resolver, customer
    helper, `/api/billing/checkout` + `/portal` + `/webhook` (signed, idempotent).
  - **Phase 2 (metering, fully wired):** errors, entitlements, usage primitives;
    enforcement on AI-listing (`/api/listings/draft`), comp-refresh
    (`/api/listings/comps/refresh`), autopublish (`/api/listings/publish`), bulk
    batch cap (publish/delist bulk), marketplace-connection cap (eBay/Etsy connect).
  - **Phase 3 (UI):** `/api/billing/usage` snapshot, public `/pricing`, in-app
    `settings/billing` with usage meters + upgrade(checkout)/manage(portal).
  - **Phase 4.1 (seats):** `membership.ts` invite/accept/revoke + seat-limit
    enforcement; `/api/account/members` routes. `accountMemberIds()` is the seam.
  RLS untouched per owner instruction (new tables follow the deny-all
  enable-no-policy convention). No live Stripe calls; no keys in repo.
  **Phase 4.2/4.3 (data-scope migration) — STARTED, foundation + core slice done,
  rest pending.** Done: `InventoryItem.accountId` + index/FK + backfill migration
  `20260625020000_inventory_account_scope` (created, NOT applied); `scope.ts`
  (`accountScope`); `getActiveAccount` widened (owner account, then active
  membership = shared workspace, then personal); inventory LIST + bulk-delete
  account-scoped; draft create stamps `accountId`; Codex follow-ups migrated item
  detail/photos/export/lifecycle/price/import/draft-detail routes plus comps/
  provider-usage/history/jobs to account scope.
  Behavior-preserving for existing owners (single-member account == old sellerId
  scope); cross-member resolution tested. SAFE because sharing is dormant in
  practice: `acceptInvite` is not yet wired into login, so no active non-owner
  memberships exist.
  **STILL PENDING (mechanical, well-patterned — replace `{ sellerId: user.id }`
  with `accountScope(account)` / `{ inventoryItem: { accountId } }`, scope by
  account after `getActiveAccount`, stamp accountId on writes):** the publish/delist pipeline
  (`publish-handler`, `bulk-publish`, `delist-handler`, `bulk-delist`) and eBay/Etsy
  adapters that thread `sellerId` (preflight, publish, delist, orphans, mapper,
  media, storage paths); decide whether `MarketplaceConnection`/`EbaySellerConfig`
  are shared or per-member. THEN wire `acceptInvite` into post-login and run a
  manual cross-member access matrix (member A and B share; outsider C blocked)
  before announcing seats. ~35 query sites; do NOT announce sharing until all are
  migrated and verified (a missed site under-shares, but is not a leak — scoping
  only ever narrows to the acting user).
  **Operator steps to run it (test mode):** apply the migration via develop; set
  sk_test/pk_test in `.env.local`; run `scripts/stripe/sync-products.ts`;
  `stripe listen --forward-to localhost:3000/api/billing/webhook`; test-card e2e.
- 2026-06-23 (Claude): Etsy marketplace channel (copy-ready) on
  `feature/etsy-marketplace-channel`. Enum + adapter + `formatEtsy` export +
  research doc + readiness-isolation tests. Migration file created, NOT applied.
  Gate green (894 tests, build 0). No live ops, no eBay gate changes.
- 2026-06-17 (Codex): started Comp Cost + Confidence Hardening on
  `feature/comp-confidence-cost-controls` (not deployed, not merged). Added
  conservative comp cost controls (`COMPS_MAX_PROVIDER_RESULTS=20`,
  `COMPS_MAX_QUERY_VARIANTS=2`, `COMPS_AUTO_MIN_IDENTITY_CONFIDENCE=0.55`),
  automatic weak-identity skip for generic draft-triggered paid comp runs,
  Apify request/result caps, stricter match scoring for generic apparel and
  size mismatches, confidence caps for possible-only / wide-spread / low-count
  sold comps, medium-confidence "needs review" copy, a paid-provider refresh
  warning, and eBay no-photo preflight mapping to `ebay_public_photo`. No
  migration added. Production env should remain
  `COMPS_AUTO_DISCOVERY_ENABLED=false` until this PR is reviewed, merged,
  deployed, and manual Refresh quality/cost is revalidated.
- 2026-06-17 (Codex): monitored post-auto-comps production, disabled
  auto-discovery, cleaned validation data, and configured the eBay public image
  bucket. One auto run since deployment: 30 fetched / 23 accepted / 7 rejected /
  high confidence / `1430` cents / no provider errors. Apify run cost about
  `$0.3641`, so `COMPS_AUTO_DISCOVERY_ENABLED=false` and
  `PRICE_COMP_AUTO_DISCOVERY_ENABLED=false` were deployed in
  `dpl_7YQvTkvZg8kjH5JMf3NUsKPV7FS2`; manual Refresh remains available. Deleted
  validation draft `5acdb635-1d42-46b9-bce9-dce3c751d9f8` and verified cascaded
  DB cleanup. Configured `EBAY_PUBLIC_IMAGE_BUCKET` to
  `sello-ebay-public-listing-photos` and deployed
  `dpl_8WGo6XPBjUKRdQLMyrKnXF7w3onB`. Derivative preflight on private-photo
  North Face item created one production `MarketplaceImage` row with a public
  URL returning 200; payload did not expose private bucket/path/original
  filename. Live eBay publish flag remains absent.
- 2026-06-17 (Codex): rolled out Full Auto Price Comps and the pending PR #36
  media migration to production. Applied
  `20260617120000_add_marketplace_images` with `npm run db:deploy`; production
  Prisma migration status is up to date. Final live deployment:
  `dpl_CSNtFhJkFf31uD3eArBxPn95PzEY`, main `1323b26`, aliased to `sello.wtf`.
  Manual Refresh validation passed first with auto-discovery off (North Face:
  30 fetched / 28 accepted / 2 rejected / high confidence / `14020` cents;
  black shirt with preserved manual comp: 30 fetched / 28 accepted / 2 rejected /
  31 total rows / high confidence / `2193` cents). Auto-discovery was then
  enabled and validated on new draft item
  `5acdb635-1d42-46b9-bce9-dce3c751d9f8` (30 fetched / 23 accepted /
  7 rejected / high confidence / `1430` cents). Passive reload/detail/inventory
  checks did not create new comp runs. Final Vercel error logs: 0 error-level
  records, no fatal records, no token-like text.
- 2026-06-17 (Codex): deployed PR #35 stabilization to production. PR merged
  into `develop` at `b5a7903`, promoted to `main`, empty `[deploy]` trigger
  `c8fd322` produced Vercel deployment `dpl_2V27PtRar6na8Bq2W656xN4ywmpq`
  aliased to `sello.wtf`. Full develop gate and final main gate passed; no
  migration added/applied. Smoke: public/app shell routes 200/307 as expected,
  unauth API 401, no production error/fatal/500 logs in 15m. Authenticated
  browser session was unavailable in Playwright, so seller-scoped editor smoke
  was not exercised live.
- 2026-06-16 (Codex): post-eBay-run stabilization on
  `feature/post-ebay-run-polish`: shared master/channel lifecycle
  sync, eBay public-photo guard + derivative pipeline plan, passive detail route
  no longer auto-fetches comps, explicit comp refresh remains seller-scoped, and
  eBay readiness blocks obvious non-sale/test wording. Gates green: prisma
  format/validate, lint (same 2 known warnings), tsc, 511 tests, build, migrate
  status.
- 2026-06-16 (Codex): first policy-safe live eBay publish through Sello
  succeeded for `Black Cotton T-Shirt Size Medium`; duplicate guard returned
  typed 409; Sello delist succeeded; fixed ended-offer cleanup detection; guarded
  cleanup succeeded; final orphan scan clean; production publish flag absent.
- 2026-06-12 (Claude): PriceComp v2 on `feature/price-comp-v2` (not merged/deployed). Additive migration `20260613020000_price_comp_v2_fields` + median-anchored pricing (sold-preference, usedInPricing/ignoredAsOutlier exclusion, confidenceScore + reasons, sold/active counts), `PATCH`/`DELETE /api/listings/comps/[compId]` (seller-scoped), upgraded comps panel (platform/status/edit/delete/toggles/median/counts/reasons, pure views split into `comps-pricing-view.tsx`), and 5 env-gated provider stubs (Apify eBay sold, Grailed sold, Poshmark sold, Depop active, Google Lens). Backward compatible (old manual comps still calculate). Gate green (lint 2 pre-existing warnings, tsc, 356 tests, prisma validate, build). Migration not yet applied to any DB. Plan in `docs/superpowers/plans/2026-06-12-price-comp-v2.md`.
- 2026-06-10 (Codex): authenticated production smoke with owner's signed-in Chrome session. Pass: dashboard, Inventory list, listing editor panels/photos, measurement add-save-reload-delete, flaw add-save-reload-delete, copy-only language, no published claims, Settings shell. Partial/fail: Depop/Poshmark/Grailed copy worked and warned, but the only visible sneaker item has no size/measurements, so exports lacked a Measurements section and warned `Missing size`; Poshmark had Brand/Size/Condition/Details and no hashtags but no Measurements section. Settings -> Marketplaces rendered connected/setup-incomplete state but auto-refresh produced a Vercel prod `POST /api/marketplaces/ebay/readiness` 502 and inline `Error: eBay API request failed.` Browser console had only unrelated Chrome extension `ethereum` injection errors. No app code changed; HANDOFF only.
- 2026-06-10 (Claude): production smoke test (read-only). Verified on sello.wtf: `/` 307→`/dashboard`, app shells render (client-side auth gate by design), `/privacy` 200, all data APIs 401 unauthenticated (export route included; auth checked before marketplace validation), no secrets in responses, **zero error/fatal/5xx Vercel production logs in 24h**. Local `develop` synced to `6faaf77` (prod `main @ a45294a` contains it). Authenticated UI flows (measurements/flaws editors, copy exports, eBay settings) not exercised: browser access was declined this session; owner should click through them once or grant browser access next time. No regression found; no code changed. Note: the 2 lint warnings are unused `_m`/`_f` in `draft-actions.test.ts` (cosmetic, fold into the next feature branch).
- 2026-06-10 (Codex): diagnosed production eBay readiness display after successful OAuth. Confirmed code uses production eBay base URLs/token rows for `EBAY_ENV=production`, and Vercel logs showed only GET readiness after callback, no POST refresh. Added auto-refresh after connected/no-checkedAt readiness, clearer setup-required copy and Seller Hub links, secondary Reconnect behavior, production readiness route test, and view-model tests.
- 2026-06-10 (Codex): replaced `README.md` from `/Users/jheller/Downloads/README_new.md`; verified exact file match and ran `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx prisma validate`, and `npm run build` (pass; lint still has 2 existing warnings in `draft-actions.test.ts`, tests now 260 passed).
- 2026-06-09 (Claude): merge-readiness review of the two feature/ui commits (merged). Verified migration safety, legacy-draft compat (new reset/duplicate tests), seller scoping, no eBay coupling. Fixed: editor let sellers exceed the draft schema's row/length caps (12 rows; label 80 / value 40 / description 400), making autosave 400 with only a generic "Save failed".
- 2026-06-09 (Claude): settings landing page at `/settings` inside the app shell (eBay connection status + manage, account name/email/sign-out, privacy link); sidebar gets a real Settings nav item and the footer gear (which silently called signOut and bounced users to login) now uses a logout icon. `feature/settings-landing` -> develop.
- 2026-06-09 (Claude): structured measurements + flaws (merged from `feature/ui`). `MeasurementSchema`/`FlawSchema` in `src/lib/ai/listing-draft.ts` (defaulted `[]` so old `validatedJson` still parses; reset/duplicate preserve them), Gemini prompt v2 (never invent measurements; placeholders with `value: null`; only visible flaws; never claim "no flaws"), nullable JSONB columns on `ListingDraft` (additive migration), editable Measurements/Flaws sections on `/inventory/[id]` (rows the seller edits get `source: "seller"`), exports prefer structured data with itemSpecifics-heuristic fallback for old drafts.
- 2026-06-09 (Claude): copy/paste listing export for Depop/Poshmark/Grailed (merged from `feature/ui`). Pure formatters in `src/lib/marketplace/export-formatters.ts`, route `GET /api/listings/[id]/export?marketplace=…` (typed `{marketplace, title, body, warnings}`; 400 bad marketplace, 401, 404 cross-seller), "Copy listing text" card on `/inventory/[id]` with per-marketplace copy buttons + warning banner. Honest copy-only: no publishing claimed.
- 2026-06-09 (Claude): production eBay OAuth enablement (feature/ebay-production-oauth -> develop -> main @ 1892879, deployed). EBAY_ENV="production" accepted; env-keyed auth/token/API URLs; connection scoping by config environment in callback/readiness/disconnect; new getEbayEnvironment() so disconnect/stored-readiness work without full credentials; publish hard-locked to sandbox (typed not_enabled in production, zero outbound calls, regression-tested). Set Vercel Production env: EBAY_TOKEN_ENCRYPTION_KEY + EBAY_OAUTH_STATE_SECRET (freshly generated), EBAY_ENV=production. EBAY_CLIENT_ID/SECRET/REDIRECT_URI_NAME were added by owner. Stray empty vars EBAY_RU_NAME / EBAY_PRODUCTION_RU_NAME remain in Vercel; safe to delete.
- 2026-06-09 (Claude): promoted develop -> main (PR #25) and deployed to production (main @ 27b7151, sello.wtf). All prior develop work now live. Account-deletion GET still returns 500 in prod until its env vars are set.
- 2026-06-09 (Claude): eBay account-deletion compliance endpoint `/api/marketplaces/ebay/account-deletion` (GET challenge hash, POST ack + best-effort connection purge + JobLog audit) + tests.
- 2026-06-09 (Claude): removed eBay Marketplace Insights source (eBay restricted access); StockX is now primary sold-comp path.
- 2026-06-09 (Claude): reframed CLAUDE.md/AGENTS.md for the full product (dropped MVP scope caps; kept integrity + deploy-safety).
- 2026-06-09 (Claude): T1–T7 autonomous batch on develop (see above).
- 2026-06-08 (Claude): Phase 0 + Phase 1 built, verified, deployed to prod; magic-link + env-config fixes; comps pipeline.

## Blocked on owner (credentials / decisions — not code)
- **Production StockX account eligibility:** Runtime config is enabled, but the
  signed-in StockX connect route returns `403`: `Your plan allows 1 connected
  marketplace. Upgrade to connect more.` Current eBay connection consumes the
  one allowed marketplace slot. Do not disconnect eBay or alter billing/plan
  entitlements without explicit operator approval.
- **Live StockX smoke:** Owner approved live listing tests, but live StockX
  create/deactivate cannot run until production env values are real, the seller
  connects StockX, and one inventory item has an exact StockX product/variant
  match, positive price/quantity, and explicit confirmation.
- **Authenticated production smoke:** Owner/admin checkout-open, non-admin
  member-denial, authenticated `/api/capabilities`, and authenticated bulk
  plan-limit UI paths still need an authenticated production seller session/token
  if not using the existing signed-in Chrome session. Route/UI policy is covered
  by tests.
- **Migration status in this shell:** `DATABASE_URL` and `DIRECT_URL` are absent
  here, so `npx prisma migrate status` cannot run locally. Use the approved DB
  context only; do not create or paste DB URLs into chat/logs.
- **Real paid checkout:** do not complete a live Stripe checkout unless the
  operator explicitly approves and uses an operator-owned payment method.
- **Live marketplace publishing:** the owner has approved controlled StockX live
  listing tests for launch readiness. Still avoid accidental bulk publish; use a
  single reviewed item and immediately verify the StockX delist/deactivate path.
- **Live eBay publishing:** `EBAY_PUBLIC_IMAGE_BUCKET` is now configured and
  derivative preflight passed, but keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent
  unless the owner explicitly approves another controlled live run.
- **Comp provider spend/quality:** Apify eBay sold comps are live only for
  manual Refresh and very strong auto-discovery candidates. Draft auto-discovery
  is enabled, but Apify still costs about `$0.32` per paid run even at
  `COMPS_MAX_PROVIDER_RESULTS=10`; find a cheaper sold-comp source/actor or add
  budget controls before increasing volume.
- **Stripe keys** for monetization.
  manual Refresh. Draft auto-discovery is disabled because the observed cost per
  auto run was about `$0.3641`; keep it disabled until
  `feature/comp-confidence-cost-controls` lands and production manual Refresh is
  revalidated with the lower caps.
- **Stripe billing (operator steps to light up `feature/stripe-billing-metering-seats`, TEST mode first):**
  1. Apply migration `20260625010000_add_billing_models` via the normal develop
     migrate flow (creates Account/Subscription/UsageCounter/etc.). Code on the
     branch assumes it is applied.
  2. Set TEST env: `STRIPE_SECRET_KEY` (sk_test), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
     (pk_test) in `.env.local` (never the repo).
  3. Run `STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe/sync-products.ts`,
     copy the printed `STRIPE_PRICE_PRO` / `STRIPE_PRICE_KINGPIN` into env.
  4. `stripe listen --forward-to localhost:3000/api/billing/webhook` to get
     `STRIPE_WEBHOOK_SECRET`; set it in env.
  5. Manual e2e: checkout Pro with test card 4242…, confirm Subscription row +
     Account.plan; cancel via portal, confirm downgrade. Flip to live keys only
     after explicit approval.
- **Worker host** (Railway/Render/Fly, or Vercel Cron) for queues + inventory sync.
- **Security follow-ups:** externalUserId binding, real eBay deletion
  notification validation, key rotation, remaining npm audit items, and RLS
  hardening.

## Next up (priority order)
1. Add a hard daily/weekly Apify budget or per-seller auto-run quota before any
   larger intake flow; current per-paid-run cost is still too high for Bulk
   Intake scale.
2. Keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent until an explicitly approved
1. Resolve StockX connection eligibility: upgrade/entitle the account for at
   least two connected marketplaces, or explicitly approve a temporary eBay
   disconnect/reconnect plan. Do not bypass billing gates silently.
2. Connect the seller's StockX account, match one inventory item to an exact
   StockX product/variant, then run one controlled live create/activate smoke
   followed immediately by the StockX delist/deactivate smoke.
3. Monitor production after the StockX env redeploy
   (`dpl_2RdUdBSdV4ewDS9eaFLgf5Rg1fiY`) for any delayed runtime errors; initial
   error/fatal/500 log filters were clean.
4. If an authenticated production owner session is available, run a
   non-destructive seller smoke for plan/quota visibility, authenticated
   `/api/capabilities`, bulk over-cap UI blocking, owner/admin checkout-open
   without payment completion, and Free portal safety.
5. Review and merge `feature/comp-confidence-cost-controls`, then deploy and
   revalidate manual Refresh before considering draft auto-discovery again.
6. Keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent until an explicitly approved
   controlled live eBay run.
7. Before a live eBay run, rerun authenticated eBay readiness/preflight in the
   UI and verify the public derivative row is reused for the target item.
8. Continue security follow-ups: externalUserId binding, real eBay deletion
   notification validation, key rotation, npm audit items, RLS hardening.
9. Stripe subscriptions and background worker host + inventory sync.

## Resume checklist
1. `cd "/Users/jheller/dev/resale-crosslister-safety"` (current Sello checkout).
2. `git fetch && git merge origin/develop` (stay current); `npm install`; `npx prisma generate`.
3. Gate: `npm run lint && npx tsc --noEmit && npm test && npm run build`.
4. Flow: `feature/* → develop → production via Vercel`. Commit + push to
   `develop`; deploy production only when the owner has explicitly requested it.

## Key gotchas
- **Next.js 16**: read `node_modules/next/dist/docs/` before writing Next code; `params`/`searchParams` are async; use `next/font`.
- **ESLint `react-hooks/set-state-in-effect` is an error**: do data fetching in an async function defined *inside* the effect; trigger refetches via a `reloadKey` state, not by calling a setState-bearing `useCallback` in the effect.
- **DB env**: runtime reads `DATABASE_URL` (the `resale_app` pooler role); don't switch to the postgres owner. Vercel also injects `POSTGRES_*` — keep `DATABASE_URL` set explicitly. `getRequiredEnv()` rejects any value containing `[`.
- **Integrity**: never fake publishing/comps; never invent prices; no secrets in code/logs/this file; scope every query to the seller.

---

# Inventory safety layer (double-sell prevention) — feat/marketplace-safety-layer

Pre-paid-customer marketplace safety layer, Part 1 (core). Built in an isolated
worktree off develop; additive only; existing eBay/Etsy/export behavior unchanged.

