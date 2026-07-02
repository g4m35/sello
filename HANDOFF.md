# HANDOFF

Living handoff doc. This project alternates between **Claude** and **Codex**
agents (the owner switches due to usage limits), so the next agent has no memory
of the last session. **Every agent MUST read this at session start and update it
before finishing.**

## How to use this file
- **Start of session:** read this top-to-bottom, plus `AGENTS.md` and `CLAUDE.md`.
- **End of session (required):** update `Last updated`, prepend a dated bullet to
  `Recent work`, refresh `Current state`, `Blocked on owner`, and `Next up`. Keep
  it accurate over exhaustive. Never put secrets here.

## Last updated
2026-07-02 — Codex. Researched and shipped a performance/navigation polish pass
after owner reported Billing felt ~2s slow. Commit
`977fe7ccf891b98d95b3bb8ecb72f8926f198708` reduces `/api/billing/usage` from
repeated subscription lookups plus three usage lookups to one subscription query
and one usage-counter query, shares the Prisma client through the handler path,
adds a short-lived client billing usage cache with Sidebar prefetch/warm-on-hover,
adds a Billing route skeleton, adds restrained Sello token-based page/nav/card/
usage-meter motion with reduced-motion support, and installs/wires
`@vercel/speed-insights` for real-user Web Vitals. Production deployment
`dpl_77sDj5cK3VhkLyH25xp6zBWnGU6J` is READY and aliased to `https://sello.wtf`.
Validation: focused billing/sidebar tests; `npx prisma validate`; `npm run lint`
(same two known warnings in `draft-actions.test.ts`); `npm test` (204 files /
1322 tests); `npm run build`; `git diff --check`; forbidden-file and diff
secret-pattern scans clean. Local Playwright smoke rendered `/pricing` and the
Billing auth/config gate; production smoke returned 200 for `/`, `/pricing`, and
`/settings/billing`, anonymous checkout remained protected with 401, leak scan was
clean, and Vercel error/fatal/500 log filters for the deployment found no
records. Existing signed-in Chrome session on `sello.wtf/settings/billing` showed
real plan/usage content after deploy, but Chrome click automation became
unreliable before a Dashboard -> Billing click-through could be completed. No
real paid checkout, no marketplace publish, no env changes, and no secrets
printed.

2026-07-02 — Codex. Fixed the Stripe Checkout cancel/back return path after the
signed-in Billing page launched checkout and Stripe returned the seller to public
`/pricing`. Commit `cf67ea19a5b6ed95e37d971ea5df43ad18040cf2` changes checkout
`cancel_url` to `/settings/billing?status=cancelled` and tightens the route test
to assert exact success/cancel URLs. Production deployment
`dpl_6FiE5HiLunbDx8L9v1R5hJ6bK3yr` is READY and aliased to `https://sello.wtf`.
Validation: focused billing route/style tests; `npx prisma validate`; `npm run
lint` (same two known warnings in `draft-actions.test.ts`); `npm test` (203 files
/ 1320 tests); `npm run build`; `git diff --check`; forbidden-file and diff
secret-pattern scans clean. Production smoke: `/`, `/pricing`, and
`/settings/billing` returned 200; anonymous checkout remained protected with 401;
Vercel error logs for the deployment found no records. No real paid checkout, no
marketplace publish, no env changes, and no secrets printed.

2026-07-02 — Codex. Corrected the signed-in billing page theme mismatch and
deployed to production. Commit `03944265bf2e59628bb6c0f0af7a81f1f22d7af7`
converts `/settings/billing` from hardcoded neutral/red Tailwind colors to the
Sello app shell/theme primitives (`Topbar`, `page`, `card`, `badge`, `Btn`,
`Banner`, and typography tokens) so it follows both light and dark mode with the
rest of the app. Added a page style regression test that blocks the old hardcoded
neutral/red classes from coming back. Production deployment
`dpl_DLGZtZgMSsfmuLhWMBAQLqfWK419` is READY and aliased to `https://sello.wtf`.
Validation: focused billing/sidebar tests; `npx prisma validate`; `npm run lint`
(same two known warnings in `draft-actions.test.ts`); `npm test` (203 files /
1320 tests); `npm run build`; `git diff --check`; forbidden-file and diff
secret-pattern scans clean. Production smoke: `/`, `/pricing`, and
`/settings/billing` returned 200; anonymous billing content remained protected by
the app/auth shell; Vercel error/fatal/500 log filters for the deployment found
no records. No real paid checkout, no marketplace publish, no env changes, and no
secrets printed.

2026-07-01 PDT / 2026-07-02 UTC — Codex. Finished PR #66:
`https://github.com/g4m35/resale-crosslister/pull/66` is merged into `develop`
as merge commit `c16859879c89fddb8d444847c30c0b33474eb060` and deployed to
production as Vercel deployment `dpl_AmqE2rKjaVS66uJcsRzW7XdLBxs1`, READY and
aliased to `https://sello.wtf`. Strict local review found and fixed one
blocker before merge: bulk delist preflight now enforces the active account
plan cap before doing preflight work (`53d2500`). Full gate passed before and
after merge: `npx prisma validate`, `git diff --check`, `npm run lint` (same two
known warnings in `draft-actions.test.ts`), `npm test` (202 files / 1318 tests),
and `npm run build`. No migration was added; local `npx prisma migrate status`
could not run because this shell has no datasource URL. PR checks were clean:
CodeRabbit success/no actionable findings, Vercel Preview Comments success,
Vercel status success but canceled by ignored-build rules, Supabase Preview
skipped because no Supabase files changed, and Vercel Agent Review neutral.
Production smoke was non-destructive: public pricing and marketplace/settings
pages loaded, anonymous checkout/portal/bulk/marketplace APIs remained protected,
invalid Stripe webhook returned `400 INVALID_SIGNATURE`, StockX publish returned
`503 STOCKX_LISTING_NOT_ENABLED`, and Vercel error/fatal/500 log filters found
no records for the new deployment. No real paid checkout, no live marketplace
publish, no live StockX listing creation, no bulk StockX publishing, no env
changes, and no secrets printed.

2026-07-01 — Codex. Started
`feature/stockx-automation-paid-beta-flow` from `develop` after pushing the
previous HANDOFF-only commit `e1b4c80cf577a98c43d00f29c47e22454c526352` to
`origin/develop`. NOT merged, NOT deployed. This pass added a coherent
paid-beta safety slice: `/api/capabilities` now returns the authenticated
account plan and limits (no env/allowlist values), the inventory bulk toolbar
and publish/delist modals show the active plan bulk limit and block over-limit
selections before bulk preflight/execute, and StockX status/capabilities now
distinguish flag presence from real OAuth/API readiness. StockX catalog/market
data are not exposed unless the required config is complete; listing creation
still only advances to the placeholder readiness gate when full API config plus
the explicit listing flag are present. Validation: `npx prisma validate` pass;
`npm run lint` pass with the two known warnings in `draft-actions.test.ts`;
`npm test` pass (201 files / 1317 tests); `npm run build` pass; `git
diff --check` pass; forbidden-file and diff secret-pattern scans clean.
`npx prisma migrate status` could not run because this shell has no datasource
URL. Vercel env-name check via `vercel env ls --scope jaky`: Production has the
required StockX names; Preview for `develop` is missing `STOCKX_CLIENT_ID`,
`STOCKX_CLIENT_SECRET`, and `STOCKX_API_KEY`. No real paid checkout, no live
marketplace publish, no live StockX listing creation, no bulk StockX publishing,
and no env files or secrets committed.

2026-07-01 — Codex. Deployed PR #65 production changes to Sello. Production
deployment `dpl_BnRkExMNcz3ceMJENqWEdFxLuMEe` is READY and aliased to
`https://sello.wtf`; deployed commit is
`557293980d38f22756227245573bc487da86dec1` (merge of PR #65). No migration was
added. Local gate before deploy: `npx prisma validate`, `npm run lint` (2 known
warnings in `draft-actions.test.ts`), `npm test` (199 files / 1308 tests),
`npm run build`, and `git diff --check` all passed. `DATABASE_URL` and
`DIRECT_URL` were absent locally, so `npx prisma migrate status` was not run;
do not fabricate DB status. Production smoke was non-destructive: `/pricing`
returned 200 and showed Free / Pro `$20/mo` / Kingpin `$119/mo`; anonymous
checkout, portal, bulk preflight/execute, eBay readiness, Etsy status, and
StockX status/connect were protected; invalid Stripe webhook signature returned
`400 INVALID_SIGNATURE`; StockX publish returned
`503 STOCKX_LISTING_NOT_ENABLED`; `/settings/marketplaces` returned 200 and
included StockX; Vercel error/fatal/500 log filters for the new deployment had
no records. Focused authenticated-policy/safety tests passed (12 files / 85
tests) for checkout/portal/bulk/StockX/queue registry. No real paid checkout,
no real marketplace publish, no live StockX listing creation, no bulk StockX
publishing, and no env values/secrets printed.

2026-07-01 — Codex. Production-readiness pass on
`feature/paid-beta-production-flow` (merged as PR #65, later deployed in
`dpl_BnRkExMNcz3ceMJENqWEdFxLuMEe`). This pass kept live marketplace
publishing and real paid checkout untouched. Added focused hardening:
`/api/billing/checkout` now requires account owner/admin authority before a
Stripe customer/session can be created, matching portal policy; bulk eBay
publish preflight now enforces the active account plan's bulk batch cap before
readiness work; StockX config tests now assert misnamed credential vars are
ignored. No schema changes. Validation: `npx prisma validate` pass; `npm run
lint` pass with the two known warnings in `draft-actions.test.ts`; `npm test`
199 files / 1308 tests pass; `npm run build` pass; `git diff --check` pass;
forbidden-file and diff secret-pattern scans clean. Vercel env-name check:
Production has the full required StockX name set; Preview is still missing
`STOCKX_CLIENT_ID`, `STOCKX_CLIENT_SECRET`, and `STOCKX_API_KEY` by name. Local
`npx prisma migrate status` could not run because this shell has no
`DATABASE_URL`/`DIRECT_URL`; do not invent a DB context.

2026-06-25 — Claude. **Ops-hardening for the sync-job worker (PR #61, branch
`feat/marketplace-safety-layer`). NOT merged/deployed.** Added a stale-running
reaper + extended the worker-route. STRICT scope: no eBay adapter/route/
delist-handler, billing, auth, or UI files touched; no secrets in code/logs/tests;
migration `20260626000000_inventory_safety_layer` still UNAPPLIED (untouched).
- New: `requeueStaleRunningSyncJobs(db,{olderThanMinutes,limit})` in
  `src/lib/inventory-sync/jobs/worker.ts`. Recovers jobs stuck in 'running' (a
  worker crashed before reaching a terminal status). See the **Stale-running
  reaper** subsection in the inventory-safety-layer section below for full behavior.
- `POST /api/inventory/sync-jobs/run`: **renamed the secret header
  `x-internal-secret` -> `x-inventory-sync-worker-secret`** (env
  `INVENTORY_SYNC_WORKER_SECRET` + 503-unset / 401-mismatch / timing-safe compare
  unchanged). Body now also accepts `requeueStale?: boolean` (default false) and
  `staleOlderThanMinutes?: number` (server-clamped to [5,1440], default 15);
  `limit` still bounded (max 25, default 10). When `requeueStale` is true the reaper
  runs FIRST, then `runQueuedSyncJobs`, so recovered jobs are re-claimed in the same
  pass. Response is sanitized counts only:
  `{ ok, requeuedStale, failedStale, claimed, succeeded, failed, skipped, needsReview }`.
- **Scheduler DECISION: NO Vercel cron added (no `vercel.json`, no GET handler).**
  The repo has no existing cron-route/CRON_SECRET pattern, and Vercel Cron can only
  send `GET` + `Authorization: Bearer $CRON_SECRET` (no custom header, no POST body),
  so it cannot authenticate this POST + custom-header endpoint without weakening it.
  Use an EXTERNAL scheduler instead (see the ops subsection for exact setup).
- Gate (in worktree): `prisma validate` pass; `tsc --noEmit` 0; `lint` 0 errors
  (2 pre-existing warnings in `draft-actions.test.ts`, unrelated); `npm test` 166
  files / **1140 tests pass** (was 1129; +11 new); `next build` success.
2026-06-25 — Codex. Continued `feature/stripe-billing-metering-seats`
Phase 4.3 account-scope migration (NOT merged, NOT deployed). No env changes, no
live Stripe/eBay/Etsy calls, no migrations applied. Committed item-centric slice
(`7bde3e2`), comps/history/jobs slice (`763e2b9`), and publish/delist slice
(`c835fbd`). Current uncommitted batch adds migration
`20260625030000_marketplace_connections_account_scope` and converts marketplace
credential/config scoping to account-level: `MarketplaceConnection`,
`EbaySellerConfig`, and `TikTokShopConfig` gain required `accountId` with
backfill from personal accounts; eBay/Etsy connect/callback/disconnect/readiness/
status/location/publish paths use active account connections; owner/admin guard
blocks non-admin members from managing credentials; plan connection caps count
distinct marketplaces by account (`free` 1, `pro` exactly 3 choices before
blocking the 4th). eBay publish/preflight/delist/orphan shared helpers and Etsy
session prefer account connection lookup when route context passes `accountId`.
`sellerId`/`userId` remain creator/acting-member attribution; direct service
fallbacks still narrow to `sellerId`/`userId` only when no route-level `accountId`
is provided. eBay account-deletion remains user-scoped by design because it is a
marketplace privacy deletion for the external user id. Provider ledger still
stores userId, with provider usage widened only to active account-member ids.

Verification this session: `npx tsc --noEmit --pretty false`; `npx prisma
validate`; focused 59-test run for comps/refresh/`[compId]`/provider-usage/
history/jobs/fetch/fetch-paid-budget; focused 158-test run across publish/delist/
bulk/eBay adapter/orphan paths; focused 103-test run across marketplace
connection/readiness/session/cap helpers; `git diff --check` clean. Stale
seller/user connection-scope scan found only optional direct-caller fallbacks and
the intentionally user-scoped eBay account-deletion handler.

Also in the current uncommitted batch: Etsy sync/delist now scope item access by
active account and pass `accountId` into the Etsy session helper; Supabase
authenticated-user resolution now accepts a matching pending team invite by
verified email before account resolution, so an invited member's first post-login
API request can land in the shared account. Verification for this follow-up:
focused 17-test Etsy sync/delist/publish run; focused 34-test auth/membership/
Etsy sync/delist/publish run; `npx tsc --noEmit --pretty false`; `git diff
--check` clean.

## Last updated (previous)
2026-06-24 — Claude. **PR #57 (gated Etsy API integration FOUNDATION) shipped to
production.** Merged PR #57 -> develop (merge `5966848`), full gate green
(prisma valid, lint 0 errors / 2 pre-existing warnings, tsc 0, 984 tests, build 0).
Promoted develop -> main as `717a672` **[deploy] Release PR #57** -> prod
**`dpl_9Va48KVjxPe6CAy9HpuK8U8zs22x`** (READY, target production). No migration, no
env values set. Health: `/`,`/dashboard`,`/inventory`,`/channels`,
`/settings/marketplaces` all 200; unauth `/api/listings` 401; new
`/api/marketplaces/etsy/status` returns 401 (new build live + fail-closed). Logs:
no error/warning/fatal/500, no raw Prisma/Etsy/eBay/token/secret. Rollback
candidate before this = `dpl_GKpzsF9pxRNbGXfK47weSUavNznk` (Release PR #56).

**Etsy live API ships OFF**: `ETSY_API_ENABLED` is unset in prod, so every Etsy
live capability is denied and copy-ready remains. To enable, set the env vars from
`docs/marketplaces/automation-options.md` §10 in the Vercel Production env (never
the repo) and redeploy; set `ETSY_API_ENABLED=true` LAST. Then a per-seller smoke:
connect (allowlist your owner email) -> readiness -> draft (no activate) before any
live publish. No live Etsy/eBay ops have run.

This adds the architecture to take Etsy from copy-ready to live, gated automation,
all fail-closed and credential-free (no live Etsy calls without env credentials,
which are NOT in the repo).

- New `src/lib/marketplace/adapters/etsy/`: config (fail-closed env + ETSY_API_ENABLED
  switch), errors (sanitized), token-crypto (AES-256-GCM), oauth (PKCE + signed
  state cookie), client (x-api-key + Bearer, 401/403/429/5xx mapping, no token/payload
  leak), capabilities (per-seller allowlist gate), session (load/refresh/shop),
  readiness, mapper, publish (draft->images->activate), delist (deactivate), sync,
  media. Plus routes under `src/app/api/marketplaces/etsy/`: connect, callback,
  disconnect, status, readiness, publish, delist, sync.
- Reuses existing `MarketplaceConnection` + `MarketplaceListing` (marketplace='etsy',
  environment='production') so **NO migration / no `db push`** was needed.
- `feature-access.ts` gained etsy entitlements (ETSY_CONNECT/PUBLISH/DELIST/ORDERS_EMAILS),
  builders now iterate. Client consumers (panel/provider) keep local deny-all literals
  (feature-access is server-only; client components import the TYPE only).
- UI: settings `EtsyConnectionCard` (states: not connected / connected / live-pending /
  copy-ready-only), gated Connect/Disconnect. Editor live-publish UI (taxonomy/shipping
  selectors + publish button) is the documented next step.
- eBay gates/readiness/publish untouched. Copy-ready Etsy export unchanged. Full gate
  green (prisma valid, lint 0 errors / 2 pre-existing warnings, tsc 0, 984 tests, build 0).
- Env names to enable live Etsy (set in deployment, never repo) are in
  `docs/marketplaces/automation-options.md` §10. Etsy live stays OFF until those +
  Etsy commercial-access approval land.

## Last updated (previous)
2026-06-24 — Claude. **PR #56 (Etsy marketplace channel) shipped to production.**
Merged PR #56 -> develop (merge `bbb0eba`), full gate green on develop (prisma
valid, lint 0 errors / 2 pre-existing warnings, tsc 0, 894 tests, build 0).
Applied the Etsy enum migration to the prod Supabase DB via `prisma migrate
deploy` (`20260623000000_add_etsy_marketplace`; `migrate status` = up to date;
`'etsy'::"Marketplace"` and `ARRAY[...,'etsy']::"Marketplace"[]` both cast OK).
Promoted develop -> main as `45240a9` **[deploy] Release PR #56** -> prod
**`dpl_GKpzsF9pxRNbGXfK47weSUavNznk`** (READY, target production, aliased to
sello.wtf). Health: `/`,`/dashboard`,`/inventory`,`/channels`,
`/settings/marketplaces` all 200; unauth `/api/listings` 401. Logs: no
error/warning/fatal/500, no raw Prisma/eBay/provider/token/secret. Prod client
bundle contains "Etsy" + "Copy-ready draft"; no "CSV later", no MCP/secret leak;
eBay "Live publishing" still present. No live Etsy/eBay ops, no eBay gate change,
no alpha users, no env changes, no `db push`.

**Current prod = `dpl_GKpzsF9pxRNbGXfK47weSUavNznk`** (main `45240a9`). Rollback
candidate before this = `dpl_HWCNrsvoaEELGboZ4R5SEnqC5mc7` (Release PR #54).

Not verifiable here (no seller login; cannot add alpha users / no live ops):
authenticated click-through that selects Etsy on a real draft and reloads, and
visually reading the copy/export output. Both are covered by green tests on the
byte-identical deployed code + the prod DB enum/array casts above.

## Last updated (previous)
2026-06-23 — Claude. **Added Etsy as a first-class marketplace channel on
`feature/etsy-marketplace-channel` (off latest `develop`). Etsy is copy-ready
(no live publish): enum + UI + copy-ready draft export + research doc. Full gate
green (prisma valid, lint 0 errors / 2 pre-existing warnings, tsc 0, 894 tests,
build 0). No env changes, no secrets, no live Etsy/eBay/browser ops, no eBay gate
changes.**

- Etsy added to the `Marketplace` enum (prisma) + app `MarketplaceSchema`, the
  adapter registry (copy-ready stub, `publish:false`, returns NOT_IMPLEMENTED),
  `ExportMarketplaceSchema` + a new `formatEtsy` (title/desc/tags/price/qty/
  condition/category/photo-checklist + "Needs seller review" advisory), display
  name/logo, feedback marketplaces, and default selectedMarketplaces.
- **Migration created but NOT applied**:
  `prisma/migrations/20260623000000_add_etsy_marketplace/migration.sql`
  (`ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'etsy'`). Owner must apply it
  via the reviewed develop->prod flow before deploying; Etsy selection persistence
  depends on it. Safe in a txn on PG12+ (value not used in the same migration).
- Research: `docs/marketplaces/automation-options.md`. The provided Etsy MCP
  (`mcp.api.etsycloud.com/mcp`) is Etsy's **official Dev MCP Server** — a docs
  assistant only; it performs no live shop/listing operations. MCP config is in
  the doc only (not added to app/runtime config).
- eBay live publish/readiness untouched; Etsy readiness is advisory and isolated
  (new `src/lib/listing/etsy-readiness-isolation.test.ts`).

## Last updated (previous)
2026-06-22 — Claude. **PR #50 (alpha smoke blockers) shipped to production, then
all Dependabot alerts cleared and shipped. No env/gate/migration changes, no live
marketplace ops, no browser smoke.**

Deploy chain (all healthy — pages 200, `/api/listings` 401, zero
error/warning/fatal logs, no leak strings):
- **PR #50** -> develop (`d38cf5c`) -> `[deploy] Release PR #50` (`bfec607`) ->
  prod **`dpl_Hw5YHsKjyhWPk9HYTVMAtmcFQvTq`** (READY). Full gate green on develop
  (prisma valid, lint 0 errors / 2 warnings, tsc 0, 883 tests, build 0).
- **Dependabot — protobufjs #10 (runtime, the only prod-runtime alert)**:
  `npm update protobufjs` -> 7.6.4 (>= patched 7.6.3; @google/genai allows
  ^7.5.4). develop (`b6dea98`) -> `[deploy] Release PR #52` (`fc11647`) -> prod
  **`dpl_2Axxx7Zaxwa7HBSc9o1WhRYsw69Q`** (READY, healthy).
- **Dependabot — dev/transitive bumps (hono 4.12.26 incl. high #13 CORS, vite
  8.0.16 incl. high #8, js-yaml 4.2.0)**: none execute in the prod runtime
  (hono is only `@prisma/client > prisma > @prisma/dev` tooling; the app never
  imports hono and sets no CORS-with-credentials, only CSP/Permissions-Policy).
  develop -> `[deploy] Release PR #54` (`2f5fe04`) -> prod
  **`dpl_HWCNrsvoaEELGboZ4R5SEnqC5mc7`** (READY, healthy). `npm audit` now reports
  **0 vulnerabilities**; 0 open Dependabot alerts; Dependabot PRs #32/#33/#34
  auto-closed. (The push banner said 9 alerts; 8 were open at triage — 1 had
  auto-resolved.)

**Current prod = `dpl_HWCNrsvoaEELGboZ4R5SEnqC5mc7`** (main `2f5fe04`). Rollback
candidate before this chain = `dpl_unMJogJ9RrrAnJVDQKmxXWNXRD8t` (Release PR #49).

Still required (owner / browser, NOT done here — no live or browser actions):
1. Confirm no old disposable eBay listings are still live.
2. Create 2 ready items + 1 deliberately blocked item (e.g. missing size).
3. Bulk publish preflight should show ready 2 / blocked 1 with the **exact**
   missing reason (e.g. "Size").
4. Publish the ready items only; verify each goes live.
5. Retry a failed/again item -> no duplicate listing.
6. Bulk end/delist the listings created in this smoke (per-item results,
   already-ended skipped, safe reasons).
7. Final prod log scan (500/error/fatal/raw Prisma/eBay/provider/token/secret).
8. Alpha verdict.

Alpha users are added via the **feature allowlist emails** (e.g.
`EBAY_DELIST_EMAILS`, `PAID_COMPS_EMAILS`, live-publish allowlist), **not**
`ADMIN_EMAILS` (which only grants the owner/admin surfaces + the 60s comps
cooldown override). No alpha users were added in this session.

---

### Earlier this session (pre-deploy detail)
2026-06-22 — Claude. **Alpha post-smoke blockers fixed on
`fix/alpha-smoke-blockers` (PR into `develop`). No env/gate/migration changes, no
live marketplace ops, no browser smoke.** (Prior "editor Discard deletes the
draft" work is on `develop` via PR #49.)

Owner manual smoke surfaced real UX/product blockers; all addressed in code +
tests on this branch:
- **Readiness unified (root cause of "100% ready with no size"):** new
  `evaluateDraftReadiness` (src/lib/listing/draft-readiness.ts) folds the content
  checks with eBay item-level requirements (condition, resolvable category, size
  when the category requires it, required item specifics, a photo, valid
  quantity). `buildReadinessView`, `mapItem`/`mapItemDetail`, and both approve
  gates (PATCH save+approve, POST mark-ready) now use it, so an item missing a
  required size can no longer be marked/shown ready. It's a strict subset of the
  publish preflight; a consistency test pins both to the same size verdict.
- **Dashboard/inventory agree:** shared `isPublishReady`/`inventoryDisplayBucket`
  — an approved-but-not-ready item shows as needs-attention in both, never ready.
- **Bulk publish reasons (root cause of the generic-failure UX):** bulk
  `executeItem` no longer collapses every failure to a flat string — it reports
  the exact missing fields and a safe specific reason; retry already re-runs the
  full publish; FAILED attempts don't poison, SUCCEEDED are skipped (existing
  publish-handler tests). Size now has its own `ebay_size` code (vs generic
  `ebay_aspects`).
- **Pricing cooldown:** owner/alpha manual refresh capped at 60s via the admin
  allowlist (code override, NOT an env change); disabled comps no longer show a
  stale long countdown (UI says "Fresh comps off — for this account/environment")
  and disabled refresh never burns a cooldown; manual comps stay ungated.
- **Smarter defaults:** new AI drafts persist eBay quantity 1 + a high-confidence
  inferred category (`applyDefaultEbayDraftFields`), never faking confidence.
- **CSV:** Import CSV removed from core seller UI (dashboard/inventory/new);
  marketplace cards say "Copy-ready draft" (shared `marketplaceCapabilityLabel`).
- **Bulk end/delist:** new flow mirroring bulk publish on the single-item
  `executeEbayDelist` (preflight classification, explicit live confirm, per-item
  results, already-ended skipped, safe failure reasons, no local delete, no raw
  payloads). Service + routes + modal + inventory "End on eBay" action + tests.
- **Sello logo** → dashboard from any page.
- **Perf:** route `loading.tsx` skeletons + sidebar nav prefetch.

Gate green: `prisma validate` OK, `lint` 0 errors (2 pre-existing warnings),
`tsc --noEmit` 0, **883 tests** (131 files), `build` exit 0. Not deployed.

## Previous update
2026-06-20 — Claude. **PR #47 shipped to production; then chrome-free pre-alpha
hardening (route error-sanitization sweep + bulk-publish test hardening) on
`chore/pre-alpha-code-hardening` (PR open into `develop`, NOT merged). No
env/gate changes, no migrations, no live ops, no browser smoke.**

Production now:
- PR #47 merged to `develop` (`46e5a5c`), promoted to `main` (`1a2f435`,
  `[deploy]`), deployed: **prod = `dpl_AYv9e4snrBpKbzByZ9dwYBgL6Wzy`** (READY),
  serving `sello.wtf`. Rollback target = `dpl_4afwkuU89pdgtNzrD3Yh8B7QoUBQ`.
  Health 200/401, zero error/warning/fatal logs.
- Verified-live earlier (prior sessions, not re-run): paid comps passed (1 paid
  call), weak-identity zero-cost skip, manual comps, ONE single eBay publish.
  Owner reports the `800215600622` delist cleanup works (not independently
  verified here — no eBay/DB access without bypassing auth).

This session's hardening (on `chore/pre-alpha-code-hardening`):
- **Route error-sanitization sweep:** 10 leaking routes (`history`, `jobs`,
  `listings/price`, `listings/import`, `listings/draft` GET+POST,
  `listings/draft/[draftId]`, `listings/[id]/photos`, `listings/[id]/export`,
  `listings/[id]/ebay-orphans`, `listings/comps/provider-usage`) converted from
  `getErrorMessage(error)` to `safeClientMessage`. The draft POST AI-failure now
  also sanitizes the message it PERSISTS to `aiOutput.errorMessage` (was raw).
  Remaining `getErrorMessage` users are the 5 eBay OAuth/readiness routes, which
  only call it in their AppError branch and route unexpected errors through
  `toEbayErrorPayload` (generic) — they don't leak; left as-is.
- **Bulk-publish test hardening:** added orchestration tests (2-ready+1-blocked
  preflight with reason, execute dedup, mixed per-item outcomes) and a new
  `bulk-publish-deps.test.ts` covering the REAL `defaultBulkPublishDeps`:
  non-owner→rejected, already-listed→skipped, gate-disabled→safe skip, ready,
  needs_details, duplicate→skip, readiness→needs_details, and raw-error→generic
  failed (no leak). Plus a representative route sweep regression
  (`history/route.test.ts`).
- Bulk publish remains **code-audited only — live browser/manual smoke still
  required.**

Gate GREEN: `prisma validate`, `tsc --noEmit` exit 0, `eslint` 0 errors (2
pre-existing `_m`/`_f` warnings), `npm test` **121 files / 835 tests**,
`npm run build` OK. No migrations; no `prisma db push`.

**Alpha verdict: DO NOT add alpha users yet.** Blockers: (1) bulk publish is
live-unverified; (2) owner confirm `800215600622`/all disposable listings are
ended; (3) owner confirm live eBay gate is in the intended owner-only state.
Add alpha users by **feature allowlist email** (`LIVE_EBAY_PUBLISH_EMAILS` /
`EBAY_DELIST_EMAILS` / `PAID_COMPS_EMAILS`), NOT `ADMIN_EMAILS`.

Next manual/browser (Chrome-capable) session, in order: (1) bulk publish smoke
with 2 ready + 1 blocked → preflight counts, explicit confirm, per-item results,
duplicate prevention; (2) delist all created listings; (3) search/action/admin
smoke; (4) final log scan; (5) alpha verdict.

## Previous update
2026-06-20 — Claude. **Chrome-free code hardening: sanitize persisted marketplace
failure reasons. PR into `develop` from
`fix/sanitize-persisted-marketplace-failure-reasons`. No env/gate/live/deploy
changes, no migrations, no browser/live smoke attempted.**

Problem: raw `error.message` (and raw eBay error objects) were persisted into
`publishAttempt.reason`, `marketplaceListing.lastError`, and
`adapterResult.ebayError`, then surfaced in the `?debug` advanced panel — so a raw
Prisma/eBay/provider/stack/token string could be stored and rendered.

Fix (defense in depth, two layers):
- New `errors.ts` helpers: `isUnsafePersistedFailureText`, `safeFailureText`,
  `safePersistedFailureReason`. Author-written AppError/EbayIntegrationError
  messages pass only if clean; raw Error/unknown never has its message persisted;
  any candidate matching a payload/stack/DB/secret pattern (Bearer, authorization,
  access/refresh token, api key, secret, password, cookie, Prisma, "deserialize
  column", pg_advisory, stack frames, JSON/XML, >200 chars) collapses to a generic
  fallback. The failure CODE is still stored separately, so troubleshooting
  category survives.
- Persistence layer: `recordEbayFailure` (publish-handler) sanitizes `reason` and
  persists only `{status, scrubbed message}` for `ebayError`;
  `recordEbayDelistFailure` (delist-handler) sanitizes `reason`+`lastError`;
  eBay `orphans.ts` cleanup sanitizes `reason`/`lastError` and reduces
  `errorDetails` to `{code, scrubbed message}`.
- Render layer: `server-map` scrubs `reason`, `lastError`/`listingLastError`, and
  `ebayErrorMessage` on the way out (so even older raw rows render safe).
- Seller-facing publish/delist responses were already sanitized (PR #44 helpers);
  this only hardens the PERSISTED + debug-rendered fields.

Tests added: `errors.test.ts` (all dangerous samples flagged; clean business
messages preserved); publish-handler (failing publish persists scrubbed
reason + `{status, "eBay returned an error."}`); delist-handler (raw failure →
scrubbed reason+lastError); server-map (debug surface scrubs raw reason/
ebayError/lastError, keeps numeric status). Existing publish/delist behavior
unchanged.

Gate GREEN: `prisma validate`, `tsc --noEmit` exit 0, `eslint` 0 errors (same 2
pre-existing `_m`/`_f` warnings), `npm test` **119 files / 820 tests**,
`npm run build` OK. No migrations; no `prisma db push`.

Bulk publish: code-audited only (no defects); **live browser/manual smoke still
required**. Browser automation remained unavailable this session.

## Previous update
2026-06-20 — Claude. **Chrome-free rollout check + code safety audit. No browser
smoke (Chrome unavailable / browser nav denied), no env changes, no gate
changes, no deploy, no migrations. TOP BLOCKER: a live disposable eBay listing
needs manual cleanup.**

State reconciliation (PRs #44→#45→#46 shipped by alternating sessions):
- Current production = `dpl_4afwkuU89pdgtNzrD3Yh8B7QoUBQ` (commit `c4161b7`, PR #46
  "sanitize comp mutation source responses"), READY, serving `sello.wtf`.
  Rollback target = prior prod `dpl_E64hcZQmCtmxJbeKjrisRXM9aGdR`. NOTE: 7
  same-commit (`c4161b7`) redeploys exist after `dpl_6Ly3…`, consistent with env
  gate toggling during the live smoke.
- Live smoke already done by a prior session (reported, not re-run here): paid
  comps passed (1 real paid call), weak-identity skipped at zero cost, manual
  comps passed, and ONE single eBay publish SUCCEEDED.

**TOP BLOCKER — live listing cleanup (manual / browser-required):**
- Live disposable eBay listing `800215600622`, price `$49.99`, Sello status
  `Active`. Must be ended before any further publish/bulk smoke or alpha users.
- There is NO safe chrome-free path to delist it: the Sello delist API needs an
  authenticated owner Supabase session + `ebayDelist` entitlement + a literal
  `confirmLiveDelist`. We must not bypass auth or ask for session tokens, so
  cleanup is browser/owner-only. Do NOT DB-mutate to fake cleanup; do NOT locally
  delete the Sello item while the eBay listing is live (server `partitionDeletable`
  blocks that anyway).
- Manual cleanup checklist: open the Sello item for `800215600622` → use
  Delist/End listing → accept the explicit "ends the live eBay listing" warning →
  confirm Sello status becomes Ended/Delisted → confirm eBay Seller Hub shows
  Ended → archive the local test item → re-scan logs → confirm no live disposable
  listing remains.

Gate state (env NAMES only — values intentionally not read/printed): all present
(`LIVE_EBAY_PUBLISH_EMAILS`, `EBAY_DELIST_EMAILS`, `PAID_COMPS_EMAILS`,
`EBAY_PRODUCTION_PUBLISH_ENABLED`, `COMPS_PAID_PROVIDERS_ENABLED`,
`COMPS_APIFY_EBAY_SOLD_ENABLED`, `COMPS_AUTO_DISCOVERY_ENABLED`,
`COMPS_ADMIN_OVERRIDE_ENABLED`, budgets/limits/cooldowns). **Owner must confirm in
the Vercel dashboard that `EBAY_PRODUCTION_PUBLISH_ENABLED` is back OFF** after the
single-publish smoke (the redeploy history implies it was toggled on).

Production logs/health (this session, read-only): `sello.wtf` 200 on
`/ /dashboard /inventory /privacy`, `401` unauthenticated `/api/listings`; over
36h zero 5xx, zero error/warning/fatal, zero `Prisma` matches. Clean.

Chrome-free code safety audit (current `main`, PR #46) — **no defects found:**
- Single publish (`publish-handler`): ownership 404; lifecycle `canPublish` gate;
  owner allowlist at route; `EBAY_PRODUCTION_PUBLISH_ENABLED` enforced in adapter
  (→403 `not_enabled` in prod); readiness re-checked; duplicate guard via
  in-memory `EBAY_PUBLISH` attempt check + DB partial-unique idempotency index.
- Bulk publish: `uniqueItemIds` dedup; no product cap (transport ceiling only);
  per-item ownership + readiness; already-listed/blocked skipped; per-item
  results; duplicate guard inherited; generic per-item messages (no raw payload).
- Delist: owner allowlist at route; ownership 404; live-artifact required
  (`LISTED` + offer/listing ids); `confirmLiveDelist` literal required; duplicate
  guard + idempotency index.
- Local delete: `partitionDeletable` blocks any `QUEUED/LISTING/LISTED/DELISTING`
  item (can't orphan a live listing).
- Paid comps: allowlist + kill-switch + caps; weak-identity zero-cost skip;
  manual comps independent; PR #46 `sellerSafeCompRows` sanitizes `source` across
  GET/POST/PATCH/DELETE; provider token only in request header, never in response.
- Search: `matchesItemSearch` covers title/brand/category/status/lifecycle/id.
- Low-pri (NOT fixed, not seller-visible): `recordEbayFailure`/
  `recordEbayDelistFailure` persist raw `error.message` to
  `publishAttempt.reason`/`lastError`, surfaced only in the `?debug` advanced
  panel — candidate for a future hardening sweep.

No code changes were needed, so the full gate was not re-run this session.

**Alpha verdict: DO NOT add alpha users yet.** Blockers: (1) clean up live listing
`800215600622`; (2) bulk publish remains UNVERIFIED; (3) owner confirm live eBay
gate is OFF. Fresh Chrome session must run cleanup FIRST, then duplicate check →
bulk publish smoke (2 ready + 1 blocked, preflight counts, explicit confirm,
per-item results, dup prevention) → delist all bulk listings → search/action/
reconnect → admin/provider-usage → log scan → final alpha verdict.

## Previous update
2026-06-19 — Claude. **Post-deploy rollout blockers fixed in code/tests on
`fix/alpha-live-actions-smoke-blockers` (off `develop`). No deploy, no env
changes, no live marketplace/paid calls, no migrations, Chrome unavailable so
NO visual/live smoke was run.**

Context: PR #43 is live in prod (`dpl_4U3LWHaYjZm5NCSG4L7ymqu3Nora`; rollback
target `dpl_C3BBeRqChtbdQzFH9WRZ5gUoFQuh`). Single eBay publish + delist passed
live; paid comps failed but leaked a raw Prisma error; admin ops showed stale
"0 allowed". Live gates + paid providers remain OFF; owner allowlists remain set.

- **Task 1 — paid-comps Prisma `void` leak (root cause + sanitize).** Root cause:
  `acquireReservationLocks` ran `SELECT pg_advisory_xact_lock(...)` via
  `$queryRawUnsafe`; `pg_advisory_xact_lock()` returns SQL type `void`, which
  Prisma `$queryRaw*` cannot deserialize ("Failed to deserialize column of type
  'void'"). It threw inside `reservePaidProviderCall`'s `$transaction` (BEFORE any
  paid provider call), propagated to the refresh route's 500 branch, and
  `getErrorMessage` echoed the raw Prisma text. Unit tests missed it because they
  mock `$queryRawUnsafe`. Fixes: switched the advisory lock to `$executeRawUnsafe`
  (no column deserialization); wrapped reservation + weak-identity ledger writes in
  `runCompFetch` so a ledger/DB failure degrades safely (paid skipped w/ sanitized
  note, free + manual comps proceed); refresh route now returns stable
  `COMPS_REFRESH_FAILED` + seller copy.
- **Task 2 — admin "0 allowed" display.** Server side was already correct
  (`configuredFeatureEmails` reads the same env as the capability gates). Bug was
  client-only: the page rendered count cards from `access` (init `null`) before
  load and never cleared a stale `error` after a recovered fetch. Extracted a pure
  `AdminMarketplaceOperationsView` (loading/error/loaded states; counts only from
  fetched data) + `setError(null)` on success. No `ADMIN_EMAILS` fallback.
- **Task 3 — API sanitization wrapper + regressions.** New `errors.ts` helpers
  (`safeErrorResponse`, `safeClientMessage`, `logUnexpectedError`,
  `GENERIC_CLIENT_MESSAGE`): AppError → its code/message/status; ZodError → 400
  INVALID_REQUEST; everything else → stable code + generic copy, logged
  server-side as class+code only (never the raw message → no token/conn-string
  leak). Applied to publish, bulk publish, bulk preflight, delist, comps refresh,
  comps GET + manual comps POST, listings GET/DELETE, lifecycle. (eBay
  readiness/connect/disconnect only surface getErrorMessage in their AppError
  branch, so they don't leak; left as-is.) Follow-up (not in this scope): other
  routes still use `getErrorMessage` in their unexpected branch and can leak raw
  text — `draft`, `draft/[draftId]`, `price`, `import`, `[id]`, `[id]/photos`,
  `[id]/export`, `[id]/ebay-orphans`, `comps/[compId]`, `comps/provider-usage`,
  `history`, `jobs`. Convert them to `safeClientMessage`/`safeErrorResponse` in a
  follow-up sweep.
- Tests added: `errors.test.ts`; provider-ledger void regression + graceful
  degradation in `fetch-paid-budget.test.ts`; refresh-route void-leak regression;
  delist + manual-comps sanitization regressions; `feature-access` count/no-fallback
  cases; `admin-marketplace-operations-view.test.tsx` (stale-zero / loading / error).
- **Gate GREEN:** `prisma validate` valid, `tsc --noEmit` exit 0, `eslint` 0
  errors (same 2 pre-existing `_m`/`_f` warnings), `npm test` **116 files / 801
  tests**, `npm run build` compiled OK (`/admin/marketplace-operations` +
  `/api/admin/marketplace-operations` stay ƒ dynamic). `.env.example` is in a
  permission-denied dir (could not edit), consistent with prior sessions.

**Production rollout recommendation:** NOT yet. These are correct, gate-passing
fixes, but the production behavior (paid-comps refresh returns a sanitized error;
admin shows real counts) has NOT been verified live — Chrome/browser automation
was unavailable, so no signed-in visual/live smoke ran. Recommend: review + merge
`fix/...` -> `develop`, then an owner-only Chrome pass (admin ops shows nonzero
counts; trigger a paid-comps refresh with paid providers still OFF and confirm a
clean sanitized message, no raw Prisma text) BEFORE promoting to `main`.

## Previous update
2026-06-19 — Claude. **Alpha Live Actions Tasks 4–9 completed on
`feature/alpha-live-actions` (worktree). No deploy, no env changes, no live
marketplace calls, no migrations.**
- Task 4 (`c367c20`): safe bulk eBay publish server — request schemas + bounded
  `processInChunks`, `preflightBulkEbayPublish`/`executeBulkEbayPublish` built on
  `executePublish` per item, `/api/listings/publish/bulk` (+preflight) routes. No
  seller-visible item cap; high configurable transport ceiling only.
- Task 5 (`a48dabe`): bulk publish UI — presentational `BulkPublishModal`, inventory
  selection flow (preflight on open, explicit confirm, refresh after), API client
  with internal chunking sharing one `bulkRunId`.
- Task 6 (`8044fab`): honest single-item actions + delete safety — `inventory-actions`
  util, server `DELETE /api/listings` partitions live listings into `blocked`,
  feature-aware publish/delist rendering, real "View live" link, Archive/Delete-draft.
- Task 7 (`705c9ab`): search + dead-action audit — `matchesItemSearch` (title/brand/
  category/status/lifecycle/id), `/api/jobs` reports eBay live publish from gate +
  entitlement, channels page dead controls replaced with real links, sync kept
  "not available yet".
- Task 8 (`c75311f`): read-only admin marketplace-operations API + page (safe fields
  only) and shared `AdminNav`.
- Task 9 (this commit): `.env.example` feature/admin/bulk vars + production caps,
  `docs/ALPHA_LIVE_ACTIONS.md` runbook, README link.
- Evidence: focused tests green per task (Task 4: 26, Task 5: 24, Task 6: 31,
  Task 7: 19, Task 8: 18 admin).
- Task 10 full gate (this commit) GREEN: `prisma generate` OK, `prisma validate`
  valid, `tsc --noEmit` exit 0, `eslint` 0 errors (2 pre-existing warnings in
  `draft-actions.test.ts`), full `npm test` **114 files / 781 tests pass**,
  `npm run build` exit 0. Build classifies `/admin/marketplace-operations` and
  `/api/admin/marketplace-operations` plus the bulk publish routes as ƒ dynamic.
  Audit: no new migrations, no `prisma db push`, no raw token/payload or provider
  IDs in seller UI (admin route extracts only `bulkRunId` from `adapterResult`).

**Current state:** Tasks 1–10 complete on `feature/alpha-live-actions`. Tasks 11–12
(production rollout) intentionally NOT started. All live gates remain
OFF/fail-closed; no allowlists populated. No deploy, no env changes.

**Blocked on owner:** None for code. Production rollout (enabling switches +
allowlists + deploy) awaits explicit owner authorization.

**Next up:** Run Task 10 full gate; then, only on owner instruction, follow
`docs/ALPHA_LIVE_ACTIONS.md` for the controlled enable + smoke + rollback.

## Previous update
2026-06-18 — Codex. **Task 3 paid-comp entitlement and identity enforcement completed on
`feature/alpha-live-actions` (this handoff's containing commit). No deploy, env changes,
live paid calls, migrations, or marketplace actions.**
- Paid comp sources now default denied in `runCompFetch`; callers must pass
  `paidProvidersAllowed: true`. Non-entitled runs exclude paid sources before ledger
  reservation, while free sources and manual comps remain available.
- Weak identity can no longer be bypassed with `force:true`: paid sources receive
  zero-cost `weak_identity` ledger skips, free sources still run, and no usable free
  evidence persists `skipped_weak_identity` with seller-safe guidance.
- Refresh requires `paidComps` access before database/provider work; draft creation
  derives access from the authenticated email; comps GET combines the global switch
  with entitlement and removes provider ids/raw errors from seller responses.
- Auto Pricing uses `FeatureAccessProvider`: nonallowlisted sellers see the selected-
  alpha message and manual action without an inert refresh button; entitled sellers
  keep refresh, spinner, cooldown, and safe limit/identity copy.
- TDD evidence: focused RED was 6 failures/27, then GREEN 27/27. Final gates: focused
  27/27, comps/draft scope 131/131, full suite 106 files/720 tests, `tsc` clean,
  Prisma valid, build green, lint 0 errors (2 pre-existing warnings).

**Current state:** Task 1/2 are preserved and Task 3 is complete on the feature branch.
The only out-of-list fixture update is `comps/get-metadata.test.ts`, required to mock
Task 1's `server-only` import after the GET route began reading feature access.

**Blocked on owner:** None for Task 3.

**Next up:** Review/integrate the Task 3 commit; keep paid providers disabled/capped
until an explicitly authorized alpha validation window.

## Previous update
2026-06-18 — Claude. **PR #42 (publish-flow dead-end fix) SHIPPED TO PRODUCTION.**
Merged `feature/publish-flow-clarity` -> `develop` (PR #42, merge `26b2b78`), then
`[deploy]` merge `develop` -> `main` (`9860ca7`) + pushed. Vercel released
production `dpl_C3BBeRqChtbdQzFH9WRZ5gUoFQuh` (Ready), serving `sello.wtf` (HTTP
200). Rollback target = prior prod `dpl_N51WG8ffFniCppUPMTVqwG5ccur2`.
- Pre-flight: no schema/migration; comp caps + eBay publish gates byte-identical
  to prior main; clean merge; gate green (tsc, lint, `npm test` 102/685, build).
- Post-deploy log scan (prod): all 200; zero error/fatal/warning; landing serves;
  NO `/publish` or `/comps/refresh` (no paid/publish calls); no secret strings.
- NOT done: interactive signed-in UI smoke test — claude-in-chrome extension was
  disconnected again and there was no live signed-in traffic to observe; shipped
  code is the gate-passing build and the approve/dashboard/cooldown logic is unit
  tested. Decision: KEEP (no rollback trigger hit).

## Previous update
2026-06-18 — Claude. **Publish-flow clarity on `feature/publish-flow-clarity`
(off `develop`, NOT pushed/deployed). No schema/migration changes; no paid
calls; no eBay production publish; no Stripe/Bulk Intake.** Fixes the reported
"Needs attention" dead-end + dashboard count bug + several UX asks:
- **Dead-end root cause:** a draft only became "ready" via the publish flow,
  which is hidden when production publishing is off, so a complete draft could
  never leave draft/"Needs attention". Fix: `ItemView` now carries readiness
  (`ready`/`missingCount`, computed in `mapItem`); new draft POST `approve`
  action marks a complete stored draft ready (re-checks readiness, rejects
  incomplete with a reason); editor gains an explicit **Mark ready** action
  (works regardless of the publish gate) + **Delete listing**; dashboard gives a
  one-click **Mark ready** to complete-but-unapproved drafts.
- **Count bug:** dashboard KPI "Needs attention" now equals the "Needs your
  attention" list (both = errors + drafts missing fields); complete drafts no
  longer show "add details", and incomplete ones show the exact missing count.
- **Pricing:** the stuck Refresh button now ticks its cooldown down client-side
  and re-enables itself.
- **Polish:** rebranded Counter -> Sello (sidebar, modals, title) + removed
  v0.4; Department/gender select in Basics (eBay Department aspect, auto-detected
  default); eBay payload "Technical preview" gated behind `?debug`; required-
  aspect dropdowns widened; new-listing intake card spacing fixed.
Gate green: prisma validate, lint (2 known warnings), tsc, `npm test`
(102 files / 685 tests), build.

**Deferred (flagged, not done):** full right-rail "one flow" redesign (kept the
existing cards; made status/actions coherent); adding department to the Gemini
identification schema (used local `detectDepartment` inference instead, no
schema change).

**Blocked on owner:** (1) review + merge `feature/publish-flow-clarity` ->
`develop`, then promote to `main` with `[deploy]` to ship (NOT pushed). (2)
Production currently runs PR #41 (`dpl_N51WG8…`); this branch is the next release.

## Previous update
2026-06-18 — Claude. **PR #41 promoted to PRODUCTION.** `develop` (d6c26d5)
merged to `main` as `[deploy]` merge `34dd71e` and pushed; Vercel built and
released production deployment `dpl_N51WG8ffFniCppUPMTVqwG5ccur2` (Ready), now
serving `sello.wtf` (HTTP 200). Previous prod was `dpl_7KixmneznJ9EiAy4omy25TuXF3oP`
(rollback target).
- Pre-flight: no schema/migration changes (both branches 16 migrations); comp caps,
  budgets, and eBay publish gates byte-identical to prior `main` (no regression);
  merge had zero code conflicts (only HANDOFF.md unioned); gate green (tsc, lint,
  `npm test` 102 files / 681 tests, build).
- Post-deploy log scan (40m window, prod): all requests HTTP 200; zero
  error/fatal/warning logs; editor flow exercised live —
  `GET /api/listings`, `GET /api/listings/{id}`, `PATCH /api/listings/draft/{id}`,
  `GET /api/listings/comps` all 200; NO `/comps/refresh` (no paid provider call);
  no secret/token strings. Decision: KEEP (no rollback trigger hit).
- NOT done: interactive signed-in UI smoke test — the claude-in-chrome extension
  was disconnected this session, so the visual checks (taxonomy label, seller copy,
  `?debug=1` diagnostics, dark/light) were not hand-verified; the shipped code is the
  gate-passing build and these behaviors are covered by unit tests.
- Hard stops honored: no migrations, no `prisma db push`, no paid providers/calls,
  no eBay production publish, no Stripe, no Bulk Intake.

**Blocked on owner:** (1) optional: reconnect the Chrome extension (or run the
manual checklist) to visually confirm the editor/pricing/publish UI on prod. (2)
GitHub Dependabot flags 9 vulnerabilities (2 high, 7 moderate) on the default
branch — triage separately. (3) Landing-page light-mode theming still open.

## Previous update
2026-06-18 — Codex. **Editor/listing alpha-UX PR #41 reviewed, fixed,
merged to `develop`, and explicitly deployed to Preview; production promotion
stopped at the Preview smoke gate. No migrations, paid provider calls, Bulk
Intake, or eBay production publishing.**

- Rebased `feature/editor-alpha-ux` from the production `main` merge onto current
  `develop`, preserving the intended `feature/* -> develop -> main` history.
- Review found and fixed one release blocker: a stale saved eBay category could
  warn while still returning `ready: true`. Commit `2c8925b` now blocks conflicting
  categories, suppresses the payload preview, and clears category-specific aspects
  when a seller chooses a replacement category.
- Full gate passed twice: Prisma validate; lint with only the two known warnings;
  `tsc`; 102 test files / 681 tests; production build.
- PR #41 merged to `develop` as `53f26e8bc8390bd34c2b2cd0213a548601793285`.
  Hosted CodeRabbit completed with no line-level issues; the diff-scoped security
  scan covered all 24 source/test rows with no reportable findings.
- Explicit Vercel Preview is Ready: deployment
  `dpl_5jFa3s3srtug4KAcXMQ8E6JF1bUz`, URL
  `https://resale-crosslister-2r6vrywg4-jaky.vercel.app`.
- Preview smoke is blocked before app load: Preview has no environment variables,
  and Vercel SSO protection is `all_except_custom_domains`; `/inventory/new`
  shows `Authentication Required`. Production was therefore not deployed.

**Current state:** `develop` contains PR #41 and is locally clean before this
handoff update. `main` and production remain unchanged. Production eBay publish
remains gated off.

**Blocked on owner:** Decide on a safe QA environment strategy: provision
Preview-only auth/database variables and an accessible staging domain/account,
or approve a separate staging project. Do not blindly clone all Production env
variables because that would connect Preview to production data/providers.

**Next up:** Make Preview/staging QA-ready, rerun the 20-step editor smoke in
light and dark mode, then promote `develop -> main` and run the focused
production smoke only if Preview passes.

## Previous update
2026-06-18 — Claude. **Editor/listing alpha-UX pass on
`feature/editor-alpha-ux` (branched off `main`). No deploy; NO migrations (schema
unchanged); no paid provider calls; eBay production publish still gated off.**
Addresses the production signed-in smoke-test findings:
- **eBay taxonomy fix (Part 3):** a basic crewneck T-shirt mapped to Men's Hoodies
  & Sweatshirts (155183). `detectItemType` now disambiguates explicitly (hoodie/
  sweatshirt word wins, then a tee word, then bare crewneck → sweatshirt). Added
  `detectEbayCategoryConflict` + `categoryConflict` on the analysis and eBay
  preflight result so the card can prompt "Change category?".
- **Live readiness (Part 2):** draft + item PATCH now return the recomputed
  `ItemDetailView` (best-effort read-back via `loadItemDetailState`; never fails the
  committed save). Editor merges only readiness/status/channels/price
  (`mergeSavedItemState`) without clobbering edits or signed photo URLs; the eBay
  readiness panel auto-rechecks on a `refreshSignal` after each save.
- **Pricing copy (Part 4):** new `lib/comps/seller-copy.ts` hides provider ids
  ("Fresh sold comps" / "Active market listings") and converts skip reasons into
  safe notes; comps GET exposes `paidProvidersEnabled`; cooldown reads "Refresh
  available in Ns"; zero evidence reads "no sold-comp evidence yet".
- **Publish panel (Part 6):** seller-facing eBay status + "what this means" + next
  action; SKU/offer/listing ids, raw errors, publish history, orphan recovery moved
  into "Advanced eBay diagnostics" (only rendered with `?debug=1`).
- **Editor actions (Part 5):** always-present primary action (Fix required fields /
  Publish to eBay / Preview eBay publish), View in inventory, a gated-publish
  explanation banner, and "Fix" jump links on the readiness checklist.
- **eBay required details (Part 8):** labeled select/text controls, Save gated on a
  value, per-field "Saved", category-conflict banner, and jump links.
- **Inventory (Part 7):** drafts already appear (no status filter, refetch on
  mount); added "View in inventory" and a regression test.

Gate green: prisma validate, lint (2 known warnings), tsc, `npm test` (102 files /
679 tests), build.

**Dark mode:** preserved and reviewed. All changed UI is token-based (no hardcoded
light-only colors in any rendered component; `.danger`/`--positive`/`--accent`
tokens used). Remaining gaps (pre-existing, NOT touched): the public landing page
`src/app/page.tsx` is hardcoded dark (29 inline hex) and does not adapt to light
mode; dead-code components (`seller-workbench`, `comps-panel`, `comps-pricing-view`,
`jobs-panel`, `status-badge`) have light-only colors but are not reachable from any
route.

**Blocked on owner:** (1) review + merge `feature/editor-alpha-ux` -> `develop`
(NOT pushed). (2) No new migrations from this branch. (3) Landing-page light-mode
theming and dead-code cleanup remain open.

## Previous update
2026-06-18 — Codex. **PR #40 blocker fixes completed on
`feature/landing-admin-feedback`; PR remains open into `develop`. No deploy;
migrations NOT applied; no Stripe/Bulk Intake/Path B.**
- **Landing page** at `/` (replaced the redirect): hero, workflow, honest marketplace
  support ("Automated where supported. Assisted where required."), sold-comp pricing
  positioned as a paid feature (copy only, no Stripe), eBay FYI (no dev account; seller
  policies for auto-publish), Grailed assisted package, early-access pricing preview, FAQ.
  Metadata + OpenGraph added. Truthful-copy + CTA assertions tested.
- **Admin access** via server-side env allowlist `ADMIN_USER_IDS` / `ADMIN_EMAILS`
  (`src/lib/auth/admin.ts`, fails closed, non-admin → 404). The server component
  `src/app/(app)/admin/layout.tsx` verifies the cookie-backed Supabase user before
  rendering either admin page; all admin APIs retain their independent bearer guard.
- **Feedback system:** `Feedback` table (migration `20260618130000_add_feedback`,
  additive, RLS, not cascaded), strict Zod, `/feedback` page + sidebar "Send feedback"
  link, `/admin/feedback` triage, APIs `POST/GET /api/feedback` (user-scoped, userId
  from session) + `GET /api/admin/feedback` + `PATCH /api/admin/feedback/[id]` (admin).
  Malformed feedback IDs are rejected before Prisma; unexpected failures return and
  log only route-specific generic codes, never raw exceptions.
- **Provider-usage admin:** owner-only `GET /api/admin/provider-usage` (cross-user
  aggregate; the seller-scoped per-user API from PR #39 is untouched) + `/admin/provider-usage`
  page (spend/calls/skipped/failures cards + recent rows). Graceful 503 if the ledger
  migration is unapplied. No tokens/secrets in any response (tested).
See `docs/ADMIN_AND_FEEDBACK.md`. Gate green: prisma validate, lint (2 known warnings),
tsc, `npm test` (97 files / 652 tests), build. The build classifies both admin
pages as dynamic server-rendered routes.

**Blocked on owner:** (1) apply migrations in order — `20260618120000_add_provider_call_ledger`
then `20260618130000_add_feedback` (`prisma migrate deploy`, both additive). (2) Set
`ADMIN_USER_IDS`/`ADMIN_EMAILS` before admin pages go live (paste into `.env.example` —
sandbox blocked `.env*`). (3) Keep paid providers disabled/capped.

## Previous update
2026-06-18 — Claude. **Hard paid-comp budget & quota controls on
`feature/comp-budget-quota-controls`; PR into `develop`. No deploy, migration NOT
applied, no provider env set.**
Adds server-side cost controls so Apify auto-discovery cannot run away on cost:
- **Gates (before any paid call), each writing a typed `ProviderCallLedger` row:**
  emergency kill switch `paid_providers_disabled`, `global_budget_exceeded`,
  `user_daily_quota_exceeded`, `user_monthly_quota_exceeded`, `draft_cooldown_active`,
  plus `weak_identity` / `provider_error`. Admin override bypasses budget/quota but
  NOT the kill switch. Free sources + manual comps are never gated.
- **New table `ProviderCallLedger`** (migration `20260618120000_add_provider_call_ledger`,
  additive, RLS on, NOT cascaded so cost history survives draft/item deletion).
  Seller-scoped log API `GET /api/listings/comps/provider-usage` (recent rows +
  today/month totals; never exposes another user's rows; no tokens/secrets stored).
- **Env (all OFF/safe by default), see `docs/COMPS_BUDGET_CONTROLS.md`:**
  `COMPS_PAID_PROVIDERS_ENABLED`, `COMPS_ADMIN_OVERRIDE_ENABLED`,
  `COMPS_APIFY_DAILY_BUDGET_CENTS`, `COMPS_APIFY_ESTIMATED_COST_CENTS`,
  `COMPS_USER_DAILY_PROVIDER_CALL_LIMIT`, `COMPS_USER_MONTHLY_PROVIDER_CALL_LIMIT`,
  `COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS`.
Gate green: prisma validate, lint (2 known warnings), tsc, `npm test` (88 files /
594 tests), build.

**Blocked on owner:** (1) apply `20260618120000_add_provider_call_ledger`
(`prisma migrate deploy`) before relying on the gates — additive/safe. (2)
`.env.example` still couldn't be edited in-sandbox — paste the `COMPS_*` budget
block from `docs/COMPS_BUDGET_CONTROLS.md`. (3) Keep `COMPS_PAID_PROVIDERS_ENABLED=false`
until caps are validated in prod. **Remaining:** a dedicated admin UI page for the
provider-usage log (the API + seller scoping exist; the pricing panel already
surfaces skip reasons via sourceErrors).

## Previous update
2026-06-17 — Codex. **Post-auto-comps monitoring completed; auto-discovery
disabled for cost/quality; eBay public image bucket configured and derivative
preflight validated without live publish.**

Monitoring window started at production deployment
`dpl_CSNtFhJkFf31uD3eArBxPn95PzEY` (`2026-06-17T16:58:03Z`). Production DB had
one post-deploy auto-discovery run before cleanup: status `auto_priced`, source
`apify-ebay-sold`, 30 fetched, 23 accepted, 7 rejected, high confidence,
recommended price `1430` cents, no provider errors. Passive GET check loaded
inventory, detail/editor, and dashboard in the signed-in Chrome session; the
`CompSearchRun` count stayed unchanged. Vercel logs had 0 error-level records
and no token-like strings. The PriceComp panel showed manual Refresh still
available.

Apify cost sanity: Apify API showed the single post-deploy actor run
`SUCCEEDED` and cost about `$0.3641`. That is too expensive for automatic calls
on every draft. Quality review also showed all accepted comps for the unbranded
black shirt were only `possible` matches while the panel still reported high
confidence; several rejected higher-end/branded shirts were correctly filtered
as outliers. Decision: disable auto-discovery in Production and keep explicit
manual Refresh enabled. Production envs `COMPS_AUTO_DISCOVERY_ENABLED=false` and
`PRICE_COMP_AUTO_DISCOVERY_ENABLED=false` were set without printing values, then
deployed via `06acb28` (`[deploy] Disable comps auto discovery by default`),
Vercel `dpl_7YQvTkvZg8kjH5JMf3NUsKPV7FS2`.

Validation draft cleanup: item `5acdb635-1d42-46b9-bce9-dce3c751d9f8` was
confirmed disposable (draft, no marketplace listings, no marketplace images),
then removed. Cascaded cleanup verified: item/photos/draft/30 comps/1 comp run
all at 0 afterward.

eBay public image bucket rollout prep: Supabase bucket
`sello-ebay-public-listing-photos` already existed, public read enabled, allowed
MIME types JPEG/PNG/WEBP, separate from private `listing-photos`. Storage policy
check showed no client write policies on `storage.objects`; service-role upload
worked, public read returned 200, and anonymous upload was denied. Production
`EBAY_PUBLIC_IMAGE_BUCKET=sello-ebay-public-listing-photos` was set without
printing values and deployed via `ebd91e7`
(`[deploy] Configure eBay public image bucket`), final live Vercel deployment
`dpl_8WGo6XPBjUKRdQLMyrKnXF7w3onB`,
`https://resale-crosslister-6sajherwn-jaky.vercel.app`, target `production`,
status `Ready`, aliased to `https://sello.wtf`.

Derivative validation without live publish: ran production eBay preflight helper
against approved North Face item `9fa01f5b-77f6-4594-87fd-ef701d64564d`, whose
original photo is private bucket `listing-photos`. Preflight returned ready,
created one production `MarketplaceImage` row, generated an opaque public path
under `ebay/production/...`, public URL returned 200, and the preflight payload
used the public bucket URL only: no private bucket, no private storage path, and
no original filename. A temporary no-photo item was created and deleted to check
blocking behavior; it blocked clearly, but the current missing id is the generic
`photo` check rather than `ebay_public_photo`.

Final Production env state by name: `COMPS_APIFY_EBAY_SOLD_ENABLED` present,
Apify token/actor present, `COMPS_AUTO_DISCOVERY_ENABLED=false`,
`PRICE_COMP_AUTO_DISCOVERY_ENABLED=false`, eBay active comps disabled, SerpApi
disabled, `EBAY_PUBLIC_IMAGE_BUCKET` present, and
`EBAY_PRODUCTION_PUBLISH_ENABLED` absent. Live eBay publishing remains disabled.

2026-06-17 — Codex. **Full Auto Price Comps + marketplace image migration rolled
out to production; auto-discovery remains enabled after manual validation.**
Starting point was `develop` commit
`1f6a8bc39ac9ff78d0f98fe8e87e04cc9463859e` (PR #37 merge). Latest `develop`
gate passed before promotion: `npx prisma format`, `npx prisma validate`,
`npm run lint` (same two existing `_m`/`_f` warnings in
`src/app/api/listings/draft/draft-actions.test.ts`), `npx tsc --noEmit`,
`npm test` (84 files / 554 tests), `npm run build`, and
`npx prisma migrate status` (only pending migration was
`20260617120000_add_marketplace_images`).

Production migration deploy: `npm run db:deploy` applied
`20260617120000_add_marketplace_images`; follow-up `npx prisma migrate status`
reported `Database schema is up to date!`. No `prisma db push` was run.

Production rollout commits/deployments:
- `12b95c5` — `[deploy] Full Auto Price Comps production rollout`, Vercel
  `dpl_6j6FztbNxHtrNLPH2pqc7nYmjP6N`.
- `8649a92` — `[deploy] Allow manual comp refresh with auto discovery off`,
  Vercel `dpl_HTctch2DCaxgX4KB3bpXQDWBSk6o`. This hotfix intentionally lets the
  explicit seller Refresh comps route call paid providers while
  `COMPS_AUTO_DISCOVERY_ENABLED=false`; draft auto-discovery stays gated.
- `1323b26` — `[deploy] Enable comps auto discovery`, final live Vercel
  deployment `dpl_CSNtFhJkFf31uD3eArBxPn95PzEY`,
  `https://resale-crosslister-88a89441q-jaky.vercel.app`, target `production`,
  status `Ready`, aliased to `https://sello.wtf`.

Production env state verified by name only: `COMPS_APIFY_EBAY_SOLD_ENABLED`
present/enabled, `APIFY_TOKEN` present, `APIFY_EBAY_SOLD_ACTOR` present,
`COMPS_REFRESH_COOLDOWN_SECONDS=60`, `COMPS_AUTO_DISCOVERY_ENABLED=true`,
`PRICE_COMP_AUTO_DISCOVERY_ENABLED=true`, eBay active comps disabled, SerpApi
disabled, `EBAY_PRODUCTION_PUBLISH_ENABLED` absent, and
`EBAY_PUBLIC_IMAGE_BUCKET` absent. Live eBay publishing therefore remains off;
if publish were later re-enabled before the public image bucket is configured,
readiness/preflight should still block on `ebay_public_photo`.

Manual Refresh comps validation passed first on production with auto-discovery
off. North Face item `9fa01f5b-77f6-4594-87fd-ef701d64564d`: 30 fetched,
28 accepted, 2 rejected, 30 comp rows, high confidence, recommended price
`14020` cents, rawJson stored, cooldown shown, no token-like text in logs/output.
Manual-preservation validation then passed on shirt item
`7d70b619-c473-40ca-b601-1a3956161862`: 30 fetched, 28 accepted, 2 rejected,
31 total comp rows, 1 preserved manual row (`manual:controlled-live-publish`),
29 rows used in pricing, high confidence, recommended price `2193` cents.
Reloading item/detail and visiting inventory did not create new `CompSearchRun`
rows.

Auto-discovery was enabled only after manual Refresh passed. Created production
draft item `5acdb635-1d42-46b9-bce9-dce3c751d9f8` from the black shirt photo;
draft generation succeeded, then one auto comp run started after draft creation:
30 fetched, 23 accepted, 7 rejected, 30 comp rows, high confidence, recommended
price `1430` cents, status `auto_priced`, rawJson stored, cooldown shown in UI.
Passive reload/detail/inventory checks kept the run count at 1. Vercel error
logs for the final deployment showed 0 error-level records, no fatal records,
and no token-like text.

2026-06-17 — Codex. **PR #35 post-eBay-run stabilization deployed to production.**
PR #35 (`feature/post-ebay-run-polish`) was merged into `develop` at
`b5a79033afcf49d86662eab3fda61062c435d3e6`, promoted to `main`, and deployed
with empty trigger commit `c8fd322cbb36aace54bd8b116a4545d00739ecb7`
(`chore: trigger production deploy [deploy]`) after the first production
deployment was canceled by the ignored-build step. Live Vercel deployment:
`dpl_2V27PtRar6na8Bq2W656xN4ywmpq`,
`https://resale-crosslister-8ouav51ti-jaky.vercel.app`, target `production`,
status `Ready`, aliased to `https://sello.wtf`.

Deployed changes:

- Added shared marketplace lifecycle sync helper. Successful eBay publish now
  updates master `InventoryItem.status` to `LISTED`; successful eBay delist
  updates the eBay channel to `DELISTED` and sets master status to `DELISTED`
  only when no active marketplace channels remain, otherwise keeps master
  `LISTED`. Orphan cleanup syncs only when channel state already proves the item
  is/was delisted, so failed unpublished cleanup does not demote an approved item.
- Added eBay sale-wording guard in readiness/preflight for obvious non-sale
  wording: `test`, `do not buy`, `dummy`, `fake`, `placeholder`,
  `not for sale`; UI labels this as `Normal sale wording`.
- Removed passive external comp fetching from `GET /api/listings/[id]`. External
  providers now stay behind explicit refresh/admin/job paths; the existing
  explicit `POST /api/listings/comps/refresh` path remains seller-scoped.
- Added eBay media guard: preflight/publish only accept photos in configured
  public marketplace bucket `EBAY_PUBLIC_IMAGE_BUCKET`; private item-photo
  buckets are blocked with `ebay_public_photo` before any eBay API call. Full
  derivative pipeline plan is in `docs/EBAY_MEDIA_PIPELINE_PLAN.md`; no schema
  migration was created.

Gates run on this branch: `npx prisma format`, `npx prisma validate`,
`npm run lint` (pass with the same two pre-existing `_m`/`_f` warnings in
`src/app/api/listings/draft/draft-actions.test.ts`), `npx tsc --noEmit`,
`npm test` (77 files / 511 tests), `npm run build`, and
`npx prisma migrate status` (`Database schema is up to date!`).
The same full gate passed on `develop`, and the final production gate passed on
`main` before push: Prisma validate, lint, TypeScript, tests, build, and migrate
status. No migration was added or applied.

Production smoke: `/` returns `307 -> /dashboard`; `/privacy`, `/dashboard`,
`/inventory`, `/settings`, and `/settings/marketplaces` return `200`;
unauthenticated `/api/listings` returns the expected `401`. The Playwright
browser context was signed out, so authenticated inventory/editor/PriceComp/eBay
preflight UI smoke was not available in this run. Vercel production logs for the
last 15 minutes showed no `error`, `fatal`, or `500` records. Vercel Production
env names show `EBAY_ENV` present, `EBAY_PUBLIC_IMAGE_BUCKET` absent, and
`EBAY_PRODUCTION_PUBLISH_ENABLED` absent. Expected eBay publish behavior after
this deploy: production publish remains disabled by flag; if the flag is later
enabled before `EBAY_PUBLIC_IMAGE_BUCKET` is configured, eBay preflight/publish
will intentionally block on `ebay_public_photo`.
2026-06-17 — Codex. **PR #37 live Apify + DB-backed comp validation completed on `feature/full-auto-price-comps`; no merge, no deploy.**
Used local credential file `.env.localll.local` without printing secrets. Live
actor `caffein.dev/ebay-sold-listings` validated through the provider with query
`Nike hoodie mens medium`: provider enabled, token kept out of URL/output, 30
sold comps returned, cap at 30 confirmed, USD price/shipping fields mapped,
external IDs present, sold dates and image URLs present after mapper fix,
conditions mapped, and raw provider payload preserved per comp.

Fixes pushed/ready for PR #37:
- Apify actor input now sends `keywords` as an array, matching the live actor
  contract (`keywords: [keywords]` plus `searchTerms: [keywords]`).
- Mapper now accepts the live actor shape: `endedAt` for sold date,
  `thumbnailUrl` for image, and separate `soldCurrency` / `shippingCurrency`
  guards while preserving USD-only behavior.
- Sanitized fixture/test updated with the live payload shape; no secrets stored.
- `.env.example` now includes the canonical `COMPS_*` / Apify / SerpApi block.

Local DB-backed validation was rerun after the owner fixed the runtime
`resale_app` pooler credential in `.env.localll.local`. Sanitized connectivity
confirmed `DATABASE_URL` present, pooler-backed, runtime role, no placeholder,
and Prisma connected as `resale_app` without printing the URL/password. Manual
refresh path validation created one temporary item (`6ae60bba-1d18-4e76-96cf-4f912ec7f348`),
ran only `apify-ebay-sold`, then deleted the item. Result: `auto_priced`,
30 fetched, 26 accepted, 4 rejected, 31 total comp rows including 1 preserved
manual comp, 30 automatic rows, 31 sold / 0 active, 27 used in pricing, rawJson
stored for every automatic row, cap at 30 confirmed, high confidence, recommended
price `4067` cents, and cleanup verified `itemDeleted: true`.

Auto-discovery registry path was also validated locally with
`COMPS_AUTO_DISCOVERY_ENABLED=true` only in-process (no env file/prod change),
with active/SerpApi providers forced off. Enabled sources resolved to
`["apify-ebay-sold"]`; the temporary auto item returned `auto_priced`, 30 fetched,
26 accepted, 4 rejected, high confidence, recommended price `4175` cents, and
cleanup verified. Passive-fetch guard remains covered by tests: item detail,
comps GET, and inventory list routes do not call `runCompFetch`; only draft POST
and explicit refresh POST are wired.

Gates run after the live mapper fix: `npx prisma format` (pass),
`npx prisma validate` (pass), `npm run lint` (pass with the same two existing
`_m`/`_f` warnings), `npx tsc --noEmit` (pass), `npm test` (84 files / 553
tests), `npm run build` (pass), and `npx prisma migrate status` (nonzero:
pending `20260617120000_add_marketplace_images`, from the eBay media branch,
not from PR #37).

## Last updated (previous)
2026-06-17 — Claude. **Full Auto Price Comps — Apify sold provider + flags/cooldown
on `feature/full-auto-price-comps`; PR opened into `develop`. No deploy, no new
migration, no provider env set.**
Audit found the comps system already ~85% built (query variants, normalize/dedupe,
IQR outliers, full match scoring, sophisticated pricing with confidence reasons,
auto-trigger after draft, and the passive detail-load fetch already removed). This
PR fills the functional gaps:
- **Apify eBay sold provider** implemented (was a stub returning `[]`):
  `run-sync-get-dataset-items`, token in the Authorization header (never logged),
  tolerant sold-comp mapping, rawJson stored, failure-safe (`[]` on any error).
  Needs `APIFY_TOKEN` + `APIFY_EBAY_SOLD_ACTOR` to return live data.
- **Centralized COMPS_* flags** (`src/lib/comps/flags.ts`) with legacy `PRICE_COMP_*`
  aliases: `COMPS_AUTO_DISCOVERY_ENABLED` (master kill switch),
  `COMPS_APIFY_EBAY_SOLD_ENABLED`, `COMPS_EBAY_ACTIVE_ENABLED`,
  `COMPS_SERPAPI_EBAY_ACTIVE_ENABLED`. eBay Browse rewired to the new flag.
- **Refresh cooldown** (`COMPS_REFRESH_COOLDOWN_SECONDS`, default 60, 0 disables)
  → 429 + Retry-After; one-shot auto run unaffected.
- **SerpApi active** dormant stub (optional). **No-passive-fetch** regression test.
- Docs: `docs/COMPS_PROVIDERS.md` (flags, costs, rollout, kill switch).
Gate green: prisma validate, lint (2 known warnings), tsc, `npm test` (83 files /
550 tests), build. No new migration (PriceComp v2 + CompSearchRun already exist).

**Update (PR #37 continued):** built the pricing UI controls — `AutoPricing` now
shows last auto-run time + refresh cooldown (disables Refresh with a countdown),
adds include/exclude + delete-manual controls and per-comp sold date / price+ship
/ used-vs-excluded badges; GET `/comps` returns `cooldownSecondsRemaining`; added
`deleteComp` to the API client. Added a sanitized Apify payload fixture + mapper
test, `docs/COMPS_LIVE_VALIDATION.md` (live validation NOT faked — no creds
in-sandbox), and extended the passive-fetch guard to the inventory-list route.
Gate green: 84 files / 553 tests, build OK, no new migration.

**Blocked on owner:** (1) `.env.example` still couldn't be edited in-sandbox
(`.env*` guarded) — paste the `COMPS_*` block from `docs/COMPS_PROVIDERS.md`.
(2) Run the live Apify validation per `docs/COMPS_LIVE_VALIDATION.md` (configure
actor + `APIFY_TOKEN`, one staging refresh, confirm payload shape), then flip
`COMPS_AUTO_DISCOVERY_ENABLED=true`. **Remaining:** live Apify run unproven
(needs owner creds); a deeper UI redesign was intentionally avoided (kept the
existing panel, added the missing controls).

## Last updated (previous)
2026-06-17 — Codex. **eBay-visible derivative media pipeline implemented on `feature/ebay-media-derivatives`; no deploy, no production env changes.**
Branch was created from latest `develop` at
`b5a79033afcf49d86662eab3fda61062c435d3e6`. PR:
https://github.com/g4m35/resale-crosslister/pull/36.

- Added additive migration
  `20260617120000_add_marketplace_images` with `MarketplaceImage` and
  `MarketplaceImageStatus`. Reuse is unique by
  `itemPhotoId + marketplace + environment`; lookup is indexed by
  `inventoryItemId + marketplace + environment + status`. RLS is enabled.
- Original uploads remain in the private app photo bucket
  `SUPABASE_STORAGE_BUCKET`. The listing detail/editor route still uses
  Supabase signed URLs for private photo display.
- Added `prepareEbayVisibleImages`, which seller-scopes the item, checks
  `EBAY_PUBLIC_IMAGE_BUCKET`, reuses existing `READY` derivative rows, or copies
  supported JPEG/PNG/WEBP originals to opaque public paths:
  `ebay/{environment}/{inventoryItemId}/{itemPhotoId}/{random-token}.{ext}`.
  Original filenames are not used in public paths.
- eBay preflight now prepares/reuses durable public derivative URLs and blocks
  with `ebay_public_photo` when bucket env/config, persisted photos, MIME type,
  or storage copy fails. eBay publish now consumes the immediately preflighted
  public derivative URLs and never maps private signed URLs into the eBay
  payload.
- `.env.example` documents `EBAY_PUBLIC_IMAGE_BUCKET`; docs now include required
  Supabase bucket settings and rollout checklist. Production bucket creation and
  env setup were intentionally not performed.

Gates run: `npx prisma format` (pass), `npx prisma validate` (pass),
`npm run lint` (pass with the same two pre-existing `_m`/`_f` warnings in
`src/app/api/listings/draft/draft-actions.test.ts`), `npx tsc --noEmit` (pass),
`npm test` (79 files / 523 tests), `npm run build` (pass), and
`npx prisma migrate status` (expected nonzero: new migration
`20260617120000_add_marketplace_images` is pending and was not applied).

Next up: review/merge the PR into `develop`, then in a separate approved rollout
apply the migration via `prisma migrate deploy`, create/configure the public
Supabase derivative bucket, set `EBAY_PUBLIC_IMAGE_BUCKET`, keep
`EBAY_PRODUCTION_PUBLISH_ENABLED` off, and run authenticated readiness to prove
private originals produce public derivative URLs before any live publish window.

## Previous update
2026-06-16 — Codex. **Post-eBay-run stabilization pass implemented on `feature/post-ebay-run-polish`; no deploy, no production migration.**
Branch was created from latest `develop` after fast-forwarding the live-run
`main` closeout back into `develop`. Changes made:

- Added shared marketplace lifecycle sync helper. Successful eBay publish now
  updates master `InventoryItem.status` to `LISTED`; successful eBay delist
  updates the eBay channel to `DELISTED` and sets master status to `DELISTED`
  only when no active marketplace channels remain, otherwise keeps master
  `LISTED`. Orphan cleanup syncs only when channel state already proves the item
  is/was delisted, so failed unpublished cleanup does not demote an approved item.
- Added eBay sale-wording guard in readiness/preflight for obvious non-sale
  wording: `test`, `do not buy`, `dummy`, `fake`, `placeholder`,
  `not for sale`; UI labels this as `Normal sale wording`.
- Removed passive external comp fetching from `GET /api/listings/[id]`. External
  providers now stay behind explicit refresh/admin/job paths; the existing
  explicit `POST /api/listings/comps/refresh` path remains seller-scoped.
- Added eBay media guard: preflight/publish only accept photos in configured
  public marketplace bucket `EBAY_PUBLIC_IMAGE_BUCKET`; private item-photo
  buckets are blocked with `ebay_public_photo` before any eBay API call. Full
  derivative pipeline plan is in `docs/EBAY_MEDIA_PIPELINE_PLAN.md`; no schema
  migration was created.

Gates run on this branch: `npx prisma format`, `npx prisma validate`,
`npm run lint` (pass with the same two pre-existing `_m`/`_f` warnings in
`src/app/api/listings/draft/draft-actions.test.ts`), `npx tsc --noEmit`,
`npm test` (77 files / 511 tests), `npm run build`, and
`npx prisma migrate status` (`Database schema is up to date!`).

## Earlier update
2026-06-16 — Codex. **First policy-safe Sello live eBay publish succeeded, duplicate guard verified, listing ended, orphan cleanup clean, production flag OFF.**
Controlled item:
`7d70b619-c473-40ca-b601-1a3956161862` / draft
`fd027d61-187f-46e2-85fb-331778e59107`, title
`Black Cotton T-Shirt Size Medium`, description
`Pre-owned black cotton T-shirt in good condition. See photos for details. Ships quickly.`,
condition `used_good` / eBay `Pre-owned`, quantity `1`, price `$4.99`,
category `15687` (`Men's T-Shirts`), SKU
`percs7d70b619c47340cab6011a3956161862`, saved aspects `Brand=Unbranded`,
`Size=Medium`, `Department=Men`, `Color=Black`, `Size Type=Regular`,
`Type=T-Shirt`, `Style=Basic`. Used the owner-provided black-shirt screenshot.
Because normal listing photos are in a private Supabase bucket while the eBay
mapper emits public object URLs, created a dedicated public bucket
`sello-ebay-public-listing-photos` and moved this one controlled item photo
there; preflight verified image URL `200`.

Phase 1 clean-state checks passed before publishing: stale failed item
`3fd6d243-dbce-4f02-953b-8367774d5305` remained `NOT_LISTED`, no stored offer or
listing IDs, deployed orphan scan returned `inventoryItemFound=false`,
`offers=[]`, `liveListingFound=false`, `cleanupAvailable=false`, Vercel
production error logs for the last two hours returned no records, and
`EBAY_PRODUCTION_PUBLISH_ENABLED` was absent from Vercel Production.

Readiness/preflight for the shirt passed before enabling live publish:
production environment, connected, `ready=true`, `publishingEnabled=false`, no
missing fields, taxonomy aspect source, quantity `1`, category `15687`, price
`4.99`, and public image status `200`. A manual PriceComp row was added. Note:
opening the deployed detail route once triggered the production auto eBay Browse
comp fetch despite the "do not start external comp scraping" instruction; those
25 `auto:` comps and the associated `CompSearchRun` were immediately deleted,
leaving only the manual comp.

Temporarily added `EBAY_PRODUCTION_PUBLISH_ENABLED=true`, pushed empty deploy
commit `b179ea7` (`chore: enable controlled ebay publish [deploy]`), and
published through production deployment `dpl_J4BB4jVhmhP6c4VmPf4yk4NzAMHy`
(`https://resale-crosslister-e3aj8jpms-jaky.vercel.app`, aliased to
`https://sello.wtf`). Rechecked preflight after deploy:
`publishingEnabled=true`, `ready=true`, no missing fields.

Single live publish succeeded through Sello's production API:
Offer ID `188679941011`, Listing ID `800192483433`,
MarketplaceListing `c61f63c3-f128-4de9-991a-f14678471dbe`,
PublishAttempt `727ee801-f16a-4715-bb34-1052eea730df`. DB state after publish:
one production eBay marketplace row, status `LISTED`, stored SKU/offer/listing
IDs, `lastError=null`, exactly one `EBAY_PUBLISH_SUCCEEDED` attempt. Deployed
orphan scan while live showed inventory item found, offer `PUBLISHED`, listing
status `ACTIVE`, and `cleanupAvailable=false`.

Duplicate protection worked: a second production publish POST returned typed
`409` / `EBAY_ALREADY_PUBLISHED` with message
`This item already has an eBay publish attempt with status SUCCEEDED. Refusing to create a duplicate listing.`
Follow-up DB check still showed one marketplace listing, one eBay publish
attempt, and the same offer/listing IDs.

Delist/cleanup succeeded. Sello delist endpoint returned `200` /
`EBAY_DELIST_SUCCEEDED` with delist attempt
`b46b8394-50b4-4df3-8d94-8ef846bc110e`; DB marketplace row changed to
`DELISTED`. eBay scan then showed offer `UNPUBLISHED` / listing `ENDED`, but the
orphan scanner treated any returned listing id as live and blocked cleanup. Fixed
that bug in commit `62e5e45`
(`fix: treat ended ebay offers as cleanup candidates [deploy]`): only
`PUBLISHED` offers or `ACTIVE` listing status count as live; added regression for
`UNPUBLISHED` + `ENDED`. Verification passed:
`npx vitest run src/lib/marketplace/adapters/ebay/orphans.test.ts` and
`npx eslint src/lib/marketplace/adapters/ebay/orphans.ts src/lib/marketplace/adapters/ebay/orphans.test.ts`.

Removed `EBAY_PRODUCTION_PUBLISH_ENABLED` before deploying the cleanup fix.
Deployment `dpl_8yapdEzhRxMq1CQ1BxPcxCaBg1et`
(`https://resale-crosslister-7xrj5tu6l-jaky.vercel.app`, aliased to
`https://sello.wtf`) reached Ready with preflight confirming
`publishingEnabled=false`. Guarded orphan cleanup then succeeded with attempt
`34aee13b-bbe5-4cb3-a2df-b00a0cf10386`, deleting the ended offer/inventory
artifacts. Final read-only scan returned `inventoryItemFound=false`,
`offers=[]`, `liveListingFound=false`, `cleanupAvailable=false`. Vercel
Production env listing confirms `EBAY_PRODUCTION_PUBLISH_ENABLED` absent.

Remaining notes/blockers: master `InventoryItem.status` remained `APPROVED`
while the eBay channel row is `DELISTED`; seller-facing channel state is correct,
but master status sync after publish/delist is a follow-up. The normal app photo
upload path still writes to the private bucket; future real eBay publishing
should formalize an eBay-visible media path instead of manual bucket movement.
Security follow-ups still open: externalUserId binding, real eBay deletion
notification validation, key rotation, remaining npm audit items, and RLS
hardening.

## Previous update
2026-06-16 — Codex. **PR #31 security hardening promoted, production migration applied, throwaway eBay publish attempted once, eBay rejected policy wording, unpublished artifacts cleaned, production flag OFF.**
Started from `develop` at `60b579f` (`Merge PR #31: security hardening review
fixes`). Full develop gate passed: `npx prisma format`, `npx prisma validate`,
`npm run lint` (same two known `_m`/`_f` warnings in
`src/app/api/listings/draft/draft-actions.test.ts`), `npx tsc --noEmit`,
`npm test` (75 files / 503 tests), and `npm run build`. `npx prisma migrate
status` showed one pending migration:
`20260616130000_add_publish_attempt_idempotency_unique`.

Production migration precheck for duplicate active publish idempotency keys
returned `duplicateGroups: 0`, so `npm run db:deploy` was run and applied only
`20260616130000_add_publish_attempt_idempotency_unique`. Follow-up
`npx prisma migrate status` reported the schema up to date, and direct index
verification found `PublishAttempt_active_idempotency_key`.

Merged `origin/develop` into `main` with merge commit
`c994f457631574e0c96c989dfff9e62d43cd4071`
(`[deploy] Promote PR #31 security hardening to production`) and pushed `main`.
Final main gate passed: `npx prisma validate`, `npm run lint` (same two known
warnings), `npx tsc --noEmit`, `npm test` (75 files / 503 tests), and
`npm run build`. Production deploy `dpl_DRHtJoAu1kQ6RLXqJbWMZJXKGSdR`
(`https://resale-crosslister-ltm3yiii7-jaky.vercel.app`) reached `READY` and
was aliased to `https://sello.wtf`.

Unauthenticated production smoke passed: `/` redirected to `/dashboard`,
`/dashboard`, `/inventory`, `/inventory/new`, `/settings/marketplaces`, and
`/privacy` loaded; `/api/listings/comps` and
`/api/marketplaces/ebay/readiness` returned `401`; invalid eBay account-deletion
POST returned `200 {"ok":true}`. Authenticated smoke with the owner's Chrome
session verified inventory loads, the eBay readiness card renders, publish is
hidden while `EBAY_PRODUCTION_PUBLISH_ENABLED` is absent, and PriceComp v2 can
add a manual sold comp, update the summary to `1 sold/completed`, reject/toggle
the comp out, and then leave no temporary comp row.

Created a clearly labeled throwaway test item
`3fd6d243-dbce-4f02-953b-8367774d5305` / draft
`0635e246-a381-4bcf-8cff-fffded96a844` with generated test image, title
`SELLO TEST LISTING DO NOT BUY Black Puffer Jacket`, category `57988`, quantity
`1`, condition `Pre-owned`, price `$1.00`, and saved eBay aspects. With the
production flag off, readiness returned `Ready for eBay`, technical preview SKU
`percs3fd6d243dbce4f02953b8367774d5305`, and read-only orphan scan was clean
before any write.

Temporarily added `EBAY_PRODUCTION_PUBLISH_ENABLED=true` and deployed the live
window as `dpl_3sDBNffdq2hEUp4WYMSPhW1bVPaw`
(`https://resale-crosslister-r6x6n20v0-jaky.vercel.app`, aliased to
`https://sello.wtf`). The final modal was verified before the single write
click: marketplace `eBay (Production)`, title
`SELLO TEST LISTING DO NOT BUY Black Puffer Jacket`, price `$1.00`, category
`Men's Jackets & Coats / 57988`, quantity `1`, condition `Pre-owned`, payment
policy `290647555015`, fulfillment policy `290647591015`, return policy
`290647677015`, and inventory location `sello-default-location`. Ticked the
explicit live-listing checkbox and clicked `Create live eBay listing` exactly
once.

Publish result: failed at eBay `publishOffer` after `inventory_item` and `offer`
succeeded. Sanitized eBay error: `HTTP 400 — Cannot revise listing. The item
cannot be listed or modified. The title and/or description may contain improper
words, or the listing or seller may be in violation of eBay policy.` Sello kept
the marketplace row `NOT_LISTED` with no stored Offer ID and no Listing/Item ID.
Read-only orphan scan found unpublished inventory and offer `188638618011` with
`Live listing: Not found`; used Sello's guarded orphan cleanup endpoint, which
recorded `EBAY_ORPHAN_CLEANUP_SUCCEEDED`. Final scan returned inventory item
`Not found`, offers `[]`, live listing `false`, cleanup unavailable.

Final safety: removed `EBAY_PRODUCTION_PUBLISH_ENABLED`, redeployed production as
`dpl_GFCzDcH6De1JsZ8bZAbyrZ5Ln8F8`
(`https://resale-crosslister-lpp3a7yio-jaky.vercel.app`, aliased to
`https://sello.wtf`), confirmed the env var is absent, and confirmed DB state for
the throwaway item is `NOT_LISTED`, SKU retained, no external offer/listing IDs,
latest attempts = cleanup `SUCCEEDED` then publish `FAILED`. Vercel production
error-level logs for the last hour returned no records; explicit `status:400`,
`status:500 error`, and `error` searches also returned no records. GitHub noted
remaining dependency vulnerabilities after pushing `main`; leave npm audit work
as a separate follow-up.

Exact next action: do not retry the same throwaway title/description. Create the
next eBay test listing with policy-safe wording (avoid `DO NOT BUY`, "test", and
other non-sale language in title/description), then run the same guarded flow
once. Security follow-ups still open: externalUserId binding, real eBay deletion
notification validation, key rotation, remaining npm audit items, and the RLS
hardening plan.

## Previous update
2026-06-16 — Codex. **TNF Nuptse live publish succeeded once, stored IDs, then was ended through Sello; production flag OFF.**
Owner confirmed the seller-account blocker was likely cleared by creating a
normal eBay listing manually, then asked to rerun the controlled Sello flow.
Confirmed the production publish flag was off/absent, then temporarily added
`EBAY_PRODUCTION_PUBLISH_ENABLED=true` and deployed the controlled live window as
`dpl_2SkZKmpbyYDzNxr52BHwNmUvp6wp`
(`https://resale-crosslister-4wt3u2111-jaky.vercel.app`, aliased to
`https://sello.wtf`). Opened the TNF Nuptse item
`9fa01f5b-77f6-4594-87fd-ef701d64564d` / draft
`ac334778-0563-4cd4-91ff-8d4cb5647a4f` and verified the final modal before the
single write click: marketplace `eBay (Production)`, title `The North Face Black
Nuptse Puffer Jacket`, price `$165.00`, category `Men's Jackets & Coats /
57988`, quantity `1`, condition `Pre-owned`, payment policy `290647555015`,
fulfillment policy `290647591015`, return policy `290647677015`, and inventory
location `sello-default-location`. Ticked the explicit live-listing checkbox and
clicked `Create live eBay listing` exactly once.

Publish result: succeeded. Sello stored SKU
`percs9fa01f5b77f6459487fdef701d64564d`, Offer ID `188443366011`, and Listing
ID `800190457084`. Sello operations showed `Production · Published` only after
those IDs were present. eBay public/Seller view showed the item live with title
`The North Face Black Nuptse Puffer Jacket`, price `US $165.00`, and custom label
matching the SKU.

Immediate cleanup: used Sello's `End eBay listing` action, accepted the native
confirmation text that this ends the live eBay listing, and Sello recorded
`Production · Delisted` / latest attempt `eBay · Delisted` in `1.6s`. eBay item
page then showed: `You ended this listing on Tue, Jun 16 at 7:30 AM by indicating
this item is no longer available` and status `ENDED`. Final safety: removed
`EBAY_PRODUCTION_PUBLISH_ENABLED`, redeployed production as
`dpl_Gaa9x3Ax3vJVEQGa2BkudPyUdLR1`
(`https://resale-crosslister-e8fo9sqbz-jaky.vercel.app`, aliased to
`https://sello.wtf`), confirmed the env var is absent, confirmed the live Publish
button disappeared while the operations panel remains `Delisted`, and checked
Vercel runtime logs for the final deployment with no error/fatal/5xx matches.
No `db:deploy` was run.

Exact next action: leave the TNF page as-is in Sello (`Production · Delisted`);
for the next live publish, create or choose a new test item so this ended listing
is not reused.

## Previous update
2026-06-16 — Codex. **TNF Nuptse live publish retried once after an app fix; eBay now blocks on seller account setup; no live listing created; orphan artifacts cleaned; production flag OFF.**
Owner asked to retry until success and use subagents. Subagent investigation
found the first 2026-06-16 blocker was an app bug: saved eBay Taxonomy aspects
were persisted on `marketplaceDrafts.ebay.aspects`, but `resolveEbayAspects`
only emitted aspects present in the local fallback requirement set, so category
`57988` lost saved `Outer Shell Material=Nylon` before publish. Fixed and
deployed commit `2e964e6` (`Fix eBay saved aspect publish payload`) on `main`:
preserve all non-empty saved eBay aspects, keep seller-saved aspect values from
being overwritten by mapper defaults, and add regressions for aspect resolution,
preflight preview, mapper output, and production publish payload. Verification
passed before deploy: focused Vitest for the eBay aspect/preflight/publish/mapper
tests, `npm run lint` (only the two known `_m`/`_f` warnings), `npm test` (469
passing), `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`.

Deployed the fix with live publishing OFF as `dpl_8oqH4WDhQf8GMiyTDh6d2Rzj4tEy`
(`https://resale-crosslister-6cu7elgom-jaky.vercel.app`, aliased to
`https://sello.wtf`). Then temporarily added
`EBAY_PRODUCTION_PUBLISH_ENABLED=true` and deployed the controlled publish window
as `dpl_J6dunnWryTecHMjpavYWVKhVS6vN`
(`https://resale-crosslister-1l6docui9-jaky.vercel.app`, aliased to
`https://sello.wtf`). Opened item
`9fa01f5b-77f6-4594-87fd-ef701d64564d` / draft
`ac334778-0563-4cd4-91ff-8d4cb5647a4f` in production. Final modal was verified
before the single write click: marketplace `eBay (Production)`, title `The North
Face Black Nuptse Puffer Jacket`, price `$165.00`, category `Men's Jackets &
Coats / 57988`, quantity `1`, condition `Pre-owned`, and payment/fulfillment/
return policy IDs plus inventory location present. Ticked the explicit
live-listing checkbox and clicked `Create live eBay listing` exactly once at
approximately `2026-06-16T02:58:16Z`.

Publish result: failed at eBay `publishOffer`; no live listing was created.
Sanitized eBay error: `HTTP 400 — A user error has occurred. Before you can list
this item we need some additional information to create a seller's account.`
This is not an app payload/aspect issue; it requires seller account setup in
eBay. Sello marketplace listing remained `NOT_LISTED`; SKU
`percs9fa01f5b77f6459487fdef701d64564d`; no stored Offer ID; no stored
Listing/Item ID. Read-only orphan scan found unpublished inventory and offer
artifact `188154323011` with live listing `Not found`; used Sello's guarded
cleanup flow after its browser confirmation that it would not continue if a live
listing was detected. Cleanup succeeded at `2026-06-16T02:58:58Z`; final scan
on the flag-off deployment showed inventory item `Not found`, offer IDs `Not
found`, live listing `Not found`.

Final safety: removed `EBAY_PRODUCTION_PUBLISH_ENABLED`, redeployed production as
`dpl_E3rbVHV6Bew87TcVtqs9LHcHkVja`
(`https://resale-crosslister-m99fe9n0k-jaky.vercel.app`, aliased to
`https://sello.wtf`), confirmed the env var is absent from Vercel Production,
and confirmed the authenticated UI no longer renders a live Publish button
(`eBay Draft preview only`, operations `Production · Not published`). Vercel
error-level logs and explicit status queries for recent `400`/`5xx` production
logs returned no records. Exact next action: finish the required eBay seller
account setup in Seller Hub, then rerun the same guarded live publish flow once;
do not change Sello code for this blocker unless eBay exposes a more specific
actionable requirement.

Previous 2026-06-16 attempt: owner gave the exact final confirmation phrase for
the TNF Nuptse live publish test. Temporarily added
`EBAY_PRODUCTION_PUBLISH_ENABLED=true` in Vercel Production and deployed
`dpl_8Uz6x5m3xP3qKHk6dQ69161BqCmy`
(`https://resale-crosslister-mpfrl62tp-jaky.vercel.app`, aliased to
`https://sello.wtf`). The single publish attempt failed at eBay `publishOffer`
with sanitized error `API_INVENTORY 25002 / HTTP 400 — The item specific Outer
Shell Material is missing. Add Outer Shell Material to this listing, enter a
valid value, and then try again.` Orphan artifact `188138721011` was cleaned and
final scan showed inventory item, offer IDs, and live listing all `Not found`.

2026-06-15 — Codex. **TNF Nuptse controlled live-publish prep paused before final confirmation.**
User approved using the TNF Nuptse jacket as the first controlled live eBay test
item, but the live publish itself was not executed because the required final
explicit browser confirmation was not provided in-session. Prepared item
`9fa01f5b-77f6-4594-87fd-ef701d64564d` / draft
`ac334778-0563-4cd4-91ff-8d4cb5647a4f`: saved eBay category `57988`
(`Men's Jackets & Coats`), quantity `1`, and eBay aspects `Type=Puffer Jacket`,
`Style=Puffer Jacket`, `Outer Shell Material=Nylon`. Production-mode preflight
with the publish flag off returned ready with no missing fields; preview SKU was
`percs9fa01f5b77f6459487fdef701d64564d`, price `$165.00`, condition
`USED_EXCELLENT`, one image, required policy IDs present, and merchant location
present. Existing production eBay marketplace row remained `NOT_LISTED` with
no stored offer/listing IDs. Temporarily added
`EBAY_PRODUCTION_PUBLISH_ENABLED=true` in Vercel Production and deployed
`dpl_2Mxae2wwsu2rAjv5JcAbaVfpbFN6`; browser showed the Publish button. No
publish modal confirmation was clicked and no eBay write was attempted. Safety
cleanup: removed `EBAY_PRODUCTION_PUBLISH_ENABLED`, redeployed
`dpl_Dryn8sSr9rRPvuSmNHi2epDj8QPp`, and confirmed the env var is absent from
Vercel Production. No Seller Hub verification or delist was performed because no
listing was created. Vercel logs for both deploys showed no error-level logs and
no queried 4xx/5xx records. Note: local `.env.local` could not decrypt the
production eBay token for orphan scan, and Vercel env pull exposed empty local
values for eBay secrets, so orphan scan was not completed outside the browser
route. Next safe action: when the owner is present, re-enable the flag, redeploy,
open the TNF draft, click Publish, review the modal, tick the live listing
confirmation, then click Create live eBay listing exactly once.
2026-06-16 — Claude. **Security-hardening branch `feature/security-hardening-review-fixes`
off `develop`; PR opened into `develop`. No deploy, no DB migration applied, no keys rotated.**
Fixed the findings from the full security review (TDD throughout):

- **CSV formula injection (MEDIUM, fixed):** extracted `csvCell`/`toCsv` into
  `src/lib/view/csv.ts`; cells starting with `= + - @`, tab, or CR are now
  single-quote-prefixed so spreadsheets treat them as text.
- **Publish/delist duplicate side effects (MEDIUM, fixed):** new partial unique
  index migration `20260616130000_add_publish_attempt_idempotency_unique` on
  `PublishAttempt(marketplaceListingId, idempotencyKey) WHERE status IN
  (QUEUED,RUNNING,SUCCEEDED)`. Handlers map the P2002 race-loser to the existing
  typed 409. **Migration CREATED ONLY — not applied** (shows as pending in
  `prisma migrate status`).
- **eBay account-deletion webhook (MEDIUM, fixed):** added ECDSA/SHA1
  `X-EBAY-SIGNATURE` verification over the raw body (`notification-signature.ts`
  + `account-deletion.ts`, fail-closed, getPublicKey via a new client-credentials
  app token). POST does no DB work unless the signature is valid; still returns
  200; GET challenge unchanged. `externalUserId` deliberately still NOT wired.
- **runCompFetch (LOW, fixed):** now takes `sellerId` and uses a scoped
  `findFirst`; all three callers updated.
- **RLS breadth (LOW):** plan only — `docs/RLS_HARDENING_PLAN.md` (defense-in-depth,
  app uses `resale_app` which bypasses RLS).
- **Dependabot (fixed):** esbuild 0.28.0→0.28.1 (lockfile only) clears both open
  alerts (GHSA-gv7w-rqvm-qjhr high, GHSA-g7r4-m6w7-qqqr low); dev-only.

Gate green on the branch: `prisma format`/`validate`, `lint` (2 known warnings in
`draft-actions.test.ts`), `tsc --noEmit`, `npm test`, `npm run build`.

**Review pass (PR #31):** one regression caught and fixed — the new partial unique
index originally also covered orphan-cleanup attempts, which are intentionally
repeatable (stable `...:orphan-cleanup` key, SUCCEEDED), so a second cleanup would
have thrown an unhandled P2002 (500). Index now excludes those keys
(`AND idempotencyKey NOT LIKE '%:orphan-cleanup'`); orphan-cleanup keeps its exact
pre-PR behavior, publish/delist stay constrained. Re-gated green: 75 files / 503
tests, build OK, migration still pending/not applied. Merged into `develop`.

**Blocked on owner (do NOT do unattended):**
1. Apply the new migration to prod ONLY after confirming there are no duplicate
   active `PublishAttempt` rows (query in the migration header). Failure to create
   the index does not mutate data.
2. Before wiring `externalUserId` (deferred Finding 4): validate the eBay signature
   verifier against real notification traffic AND add the `commerce.identity.readonly`
   OAuth scope (current scopes are only `sell.inventory`/`sell.account`; new scope =
   seller re-consent). Also confirm Identity API `userId` == deletion-notification
   `userId`.
3. **Rotate the secrets** that lived in the stray `.env.localll.local` (now deleted;
   it was git-ignored and never committed): Supabase service-role key, Gemini API
   key, DB pooler/direct URLs, KV/Redis tokens, Vercel OIDC token.

Also remaining (outside the 2 Dependabot alerts, NOT acted on): `npm audit` still
flags `hono` (high), `vite` (high, dev-only), `js-yaml`, `protobufjs` — review
separately; a broad `npm audit fix` could disturb the build.

## Previous update
2026-06-16 — Codex. **Code reconciliation branch prepared from latest `develop`; no deploy.**
Created/reset `feature/reconcile-ebay-pricecomp` from `origin/develop` at
`e577694` and merged `origin/feature/ebay-required-aspects`; the merge was
already contained in `develop` and reported `Already up to date` with no
conflicts. To preserve the later live eBay required-aspects fix that existed on
`main` but not `develop`, cherry-picked `2e964e6` (`Fix eBay saved aspect
publish payload`) onto the branch. The resulting code diff is limited to six
eBay aspect/publish payload files and preserves PriceComp v2 migrations and comp
APIs from `develop`.

Verification passed on the branch: `npx prisma format`, `npx prisma validate`,
`npm run lint` (2 known warnings in `draft-actions.test.ts`), `npx tsc
--noEmit`, `npm test` (71 files / 469 tests), and `npm run build`. No
`db:deploy` was run and no Vercel deploy was run. Final migration list remains:
`20260518162000_init`, `20260518170000_add_price_comp`,
`20260520210000_add_publish_persistence`,
`20260529223000_add_ebay_sandbox_connections`,
`20260530000000_add_ebay_listing_publish_fields`,
`20260531000000_enable_ebay_connection_rls`,
`20260606030000_fix_ebay_advisor_findings`,
`20260609120000_add_draft_measurements_flaws`,
`20260612010000_guarded_ebay_production_publish`,
`20260613010000_backfill_ebay_quantity`,
`20260613020000_price_comp_v2_fields`,
`20260614120000_add_comp_search_runs`. Next action: review/merge the PR into
`develop`; do not deploy from this branch directly.

## Previous update
2026-06-14 — Claude. **Second controlled live-eBay-publish test. Pipeline proven;
NO live listing created (blocked on incomplete eBay required aspects). 4 real bugs
fixed and DEPLOYED TO PROD — but they live only on local branch
`fix/ebay-apparel-condition`, NOT on `main`/`develop` (CODE DIVERGENCE, read below).
Production flag is OFF again.**

- **Listing used:** TNF Black Nuptse Puffer Jacket, item `9fa01f5b-77f6-4594-87fd-ef701d64564d`,
  $165, seller `4372cfcf-…`. SKU `percs9fa01f5b77f6459487fdef701d64564d`. Owner set
  Size=S (was the only readiness gap). It is the cheapest viable real item; no
  truly "cheap" item exists in inventory (only other ready item is a $1500 Travis
  Scott shoe, excluded by the non-goal).
- **Flag:** was set `true` + prod redeployed for the window; after the test the
  var was **removed** from Vercel production and prod redeployed
  (`resale-crosslister-5ugpy4dk9`, aliased sello.wtf). Verified in the authenticated
  UI that the Publish button is **gone** with the flag off. Gotcha: `vercel env
  pull` masks sensitive vars to empty, so the flag value is NOT readable via CLI —
  confirm via the UI button presence, not pull.
- **Publish result:** FAILED — no live listing. Each attempt got further as bugs
  were fixed; final blocker is the `Type` item-specific. Stored IDs: none (SKU is
  recorded on the MarketplaceListing row; Offer/Listing IDs not stored). Orphan
  inventory item + unpublished offer were created on each failed publishOffer and
  **cleaned up** every time; final eBay orphan scan = Inventory item / Offer /
  Live listing all "Not found" (eBay is clean).
- **4 bugs fixed (TDD + full gate green each: lint, tsc, 447 vitest, build), branch
  `fix/ebay-apparel-condition`:**
  1. `a1f65dc` eBay condition for apparel: used grades → `USED_EXCELLENT` (3000
     "Pre-owned"); media `USED_GOOD`(5000)/`USED_ACCEPTABLE`(6000) are invalid for
     clothing (cat 57988). Review label now "Pre-owned". (`mapper.ts`,
     `publish-review.ts`)
  2. `f280e09` publish duplicate guard counted the orphan-cleanup SUCCEEDED
     PublishAttempt as a publish → item became un-publishable after cleanup. Now only
     `code.startsWith("EBAY_PUBLISH")` attempts block. (`publish-handler.ts`)
  3. `2d154b1` Department aspect was dropped for single-gender apparel categories;
     eBay requires it. Now required + auto-resolved from category gender
     (CATEGORY_DEPARTMENT). (`ebay-aspects.ts`)
  4. `6891be0` Size Type aspect missing for apparel; now required + default
     "Regular". (`ebay-aspects.ts`)
- ⚠️ **CODE DIVERGENCE — reconcile before any `main` deploy.** These 4 commits were
  deployed to prod via `vercel deploy --prod` from the working tree but are **only on
  the local branch `fix/ebay-apparel-condition` (not pushed, not on `main`/`develop`)**.
  Production currently runs these fixes; `main` does NOT. Deploying `main` as-is would
  ROLL BACK all 4 fixes. Next agent: get owner approval, then merge
  `fix/ebay-apparel-condition` → develop → main and push, OR re-apply.
- **Remaining blocker (the real next milestone):** category 57988 also requires the
  `Type` item-specific (e.g. "Puffer"), which has no honest auto-default — it needs
  per-item seller input. The local `ASPECTS_BY_CATEGORY` table is an approximation;
  the correct fix is to source the real required set from eBay's
  `getItemAspectsForCategory` (Metadata API) and add a seller-facing field for
  aspects Sello can't resolve (Type, etc.). Until then, apparel live-publish will
  keep failing on Type.
- **Minor issues noted (not fixed):** (a) the operations panel renders the
  orphan-cleanup SUCCEEDED attempt with a misleading green "Live" badge (cosmetic);
  (b) `POST /api/listings/publish` returns 502 for eBay user-error 400s (missing
  aspect) — arguably should be a 4xx; the error body is surfaced correctly either way.
- **Vercel logs:** no error/fatal; 3 expected `502`s on `/api/listings/publish`
  (the Department/Size Type/Type aspect failures). The token auto-refresh works (the
  expired access token refreshed fine; orphan scan made authorized eBay calls).

## Previous update
2026-06-14 — Codex. **Gemini authentication-note validation fix promoted and
deployed.**
- Root cause: Gemini structured-output schema allowed unconstrained
  `identification.authenticationNotes` strings, while Zod enforced
  `max(240)`, so a long but otherwise usable note made draft generation fail
  with `Gemini JSON failed validation`.
- Fix commit `b1f5873` was fast-forwarded through `develop` and `main`, pushed,
  and deployed to production (`dpl_CcYZa6GtUsBUmwwgrfTE8jhVJEyY`,
  `https://resale-crosslister-gqckp6pk1-jaky.vercel.app`, aliased
  `https://sello.wtf`). `src/lib/ai/listing-draft.ts` now advertises
  `minLength: "1"` / `maxLength: "240"` for short AI note/warning strings in the
  Gemini response schema and clips overlong generated authentication
  notes/warnings to the app limit before strict validation.
  Malformed JSON and shape/type failures still fail loudly.
- Tests added in `src/lib/ai/listing-draft.test.ts` for the exact oversized
  authentication-note failure and for the outbound Gemini schema limit.
- Verification passed: focused `npx vitest run src/lib/ai/listing-draft.test.ts`,
  `npm run lint` (2 pre-existing warnings in `draft-actions.test.ts`), `npm test`
  (64 files / 417 tests), `npx prisma validate`, and `npm run build`.
- `db:deploy` was NOT run; the diff against pre-deploy `origin/main` had no
  Prisma/schema/migration changes.
- Production retry used the already-open Chrome tab with the still-loaded image,
  clicked `Try again`, and succeeded: the app navigated to
  `https://sello.wtf/inventory/9fa01f5b-77f6-4594-87fd-ef701d64564d` and rendered
  a draft for "The North Face Black Nuptse Puffer Jacket" with no Gemini
  validation error visible.
- Vercel log checks after retry (`--level error`, `--query error`, `--status-code
  400`, `--status-code 500`) returned no matching entries.

## Previous update
2026-06-14 — Claude. **First-live-eBay-publish rehearsal + safety hardening.
Flag still OFF; no live listing created.**
- Safety audit of the production publish path. Confirmed the lock holds: with
  `EBAY_PRODUCTION_PUBLISH_ENABLED` OFF, `publishImplementedFor("ebay")` is
  false so no live publish button can render (`canLivePublish` false on the
  listing page; the publish modal cannot open), and a direct call to the
  publish route returns typed `EBAY_PUBLISH_NOT_ENABLED` (403) with a
  `publish_blocked` event and zero outbound eBay calls. Readiness and the
  dry-run preflight are flag-independent and still work.
- Final-review UX (behind the flag only): the publish modal now loads the
  dry-run preflight and shows a human review (marketplace, title, price,
  category, quantity, condition, payment/fulfillment/return policies, inventory
  location). A live publish requires ticking an explicit "creates a live eBay
  listing" confirmation; the button is gated on `reviewReady && confirmed`.
  Because the review is built from the same preflight payload the publish
  sends, what the seller confirms cannot drift from what eBay receives.
- New pure helper `buildEbayPublishReview` / `canSubmitLiveEbayPublish`
  (`adapters/ebay/publish-review.ts`) + `api.ebayPreflight` client method.
- Docs: added `docs/FIRST_LIVE_PUBLISH.md` (runbook: listing, fields, policies,
  location, payload preview, duplicate protection, attempt/event logging,
  delist recovery, flag enable/disable, rollback/cleanup) and linked it from
  `docs/SELLO_ROADMAP.md`.
- Tests: +6 (publish-review parity + confirmation gate; modal live-review and
  flag-off hiding). Existing flag-off coverage in `server-map.test.ts`,
  `publish/route.test.ts`, `publish.test.ts`, and `preflight.test.ts` left
  intact. Full gate: lint (2 pre-existing warnings only), `vitest` 403 passing,
  `prisma validate`, `tsc --noEmit`, `next build` — all green.
- Shipped: commit `eae252c` on `feature/first-live-publish-rehearsal`,
  fast-forwarded to `main` and pushed (`e51976a..eae252c`), then
  `vercel deploy --prod` (deployment `dpl_9hRQ3PEp4EVxiAZuBgYaFR3Y3Anj`,
  `● Ready`, target production, aliased https://sello.wtf).
- Production verification (unauthenticated, since this was an away session with
  no live browser): `/` 307 -> `/dashboard` 200; `/inventory`, `/privacy`,
  `/settings/marketplaces` 200; publish API is auth-gated
  (`POST /api/listings/publish` -> 401 before any logic); no 5xx observed.
  `EBAY_PRODUCTION_PUBLISH_ENABLED` is NOT set in any Vercel environment, so it
  resolves OFF in production (the safest default) — the flag was not touched.
  Authenticated UI checks (Ready-for-eBay badge, quantity 1, operations panel,
  literal absence of the publish button in the DOM) could not be run without a
  logged-in browser; the flag-off guarantee is enforced by config + code +
  tests (`server-map.test.ts`, `publish/route.test.ts`).

## Previous update
2026-06-14 — Codex. **Source reconciliation shipped: eBay live production code
and PriceComp v2 now coexist on `main` and production.**
- PR #29 (`feature/reconcile-ebay-pricecomp` → `develop`) merged cleanly, then
  `develop` was merged into `main` and deployed with `vercel deploy --prod`.
  This reconciles live eBay production code `feature/ebay-required-aspects @
  78009c32159fb2e4c06cd7a518e6eaf1650007aa` with PriceComp v2.
- **Prod DB migration state is fully verified APPLIED** (direct, read-only
  `_prisma_migrations` query before merge/deploy):
  - `20260613020000_price_comp_v2_fields` — APPLIED.
  - `20260612010000_guarded_ebay_production_publish` — APPLIED.
  - `20260613010000_backfill_ebay_quantity` — APPLIED.
  Because these migrations were already recorded in production, **`db:deploy`
  was NOT run** for this reconciliation deploy. Fresh `prisma migrate status`
  reported the DB schema up to date with 11 migrations.
- Merge had no conflicts. Verification on the reconciliation branch passed:
  `npx prisma format`, `npx prisma validate`, `npm run lint` (2 existing warnings
  in `src/app/api/listings/draft/draft-actions.test.ts`), `npx prisma generate &&
  npx tsc --noEmit`, `npm test` (60 files / 384 tests), and `npm run build`.
- Production smoke passed: `/dashboard`, `/inventory`, and the sneaker listing
  editor loaded; PriceComp v2 columns exist in prod and the listing's empty comps
  state rendered; eBay readiness shows `Ready for eBay`, category
  `Men's Athletic Shoes / 15709`, `Quantity: 1`, and no live publish button while
  `EBAY_PRODUCTION_PUBLISH_ENABLED` remains off; account-deletion challenge
  returns `challengeResponse`; Vercel runtime logs showed no new 4xx/5xx/error
  records.

## Previous update
2026-06-13 — Claude. **PriceComp v2 release HELD after partial promotion;
migration state now VERIFIED applied. Read this before deploying anything.**
- **Prod DB migration state is fully verified APPLIED** (direct, read-only,
  per-branch `prisma migrate status` against prod):
  - `20260613020000_price_comp_v2_fields` — APPLIED.
  - `20260612010000_guarded_ebay_production_publish` — APPLIED.
  - `20260613010000_backfill_ebay_quantity` — APPLIED.
  `migrate status` from `develop` (9 migrations) AND from
  `feature/ebay-required-aspects` (10 migrations) BOTH report "Database schema is
  up to date!", so the prod DB holds the **union** of the eBay migrations and the
  PriceComp v2 migration. **Correction:** an earlier entry guessed the eBay
  migrations "appeared unapplied" (inferred from develop's status) — that was WRONG;
  they are applied.
- **Live production = `dpl_BB7eRKiHMqKZ...`** (READY, target production, aliased to
  `sello.wtf`, deployed via `vercel --prod` by codex), commit
  **`78009c32159fb2e4c06cd7a518e6eaf1650007aa` (`78009c3`)** from
  `feature/ebay-required-aspects`. Confirmed via the Vercel deployment record.
- `develop` was merged into `main`; **`main` is now @
  `1a80b5ef97fca50ff71a47b98f5fd4cc7c441d7d`** and contains PriceComp v2, but it was
  **NOT deployed**. The `main` push did NOT auto-deploy — Vercel canceled the build
  (`dpl_C5G5Tk68...`, CANCELED) via the repo's ignored-build-step; production
  releases here require an explicit `vercel --prod`.
- **Runtime: no risk.** Live code (`78009c3`) reads/writes
  `MarketplaceListing.environment` and `PublishAttempt.idempotencyKey` in the eBay
  publish path (`src/lib/marketplace/publish-handler.ts`); those columns exist in
  prod (migrations applied), so production is self-consistent.
- ⚠️ **Do NOT deploy the current `main`.** The ONLY remaining release risk is **code
  divergence**: live prod runs `feature/ebay-required-aspects` code, while `main` has
  PriceComp v2 but NOT that eBay code — deploying `main` as-is would roll back the live
  eBay work. The prod DB is NOT a blocker (already migrated for both).
- **Before PriceComp v2 can go live, reconcile `feature/ebay-required-aspects`
  (`78009c3`) into `develop`/`main`.** A `git merge-tree` trial shows
  `develop` + `feature/ebay-required-aspects` merges **conflict-free** (only
  `prisma/schema.prisma` + `HANDOFF.md` touched by both, both auto-merge). Plan:
  `docs/superpowers/plans/2026-06-13-reconcile-ebay-and-pricecomp.md`.
- Because the prod DB already has all migrations, `db:deploy` during the combined
  release is expected to be a **no-op** ("No pending migrations to apply") — but still
  run and verify it before deploying.
- This entry is a docs-only commit on `develop`; no branch merges, no deploy.

## Previous update
2026-06-13 — Claude. **PriceComp v2 merged into `develop`** (PR #28; develop @
`f52b60b15115b44e264e0b942ffbc1abcb3e76bb`, includes review fix `cd9c998` that
moves the auth/ownership check before body-parse on
`PATCH /api/listings/comps/[compId]`). **`main`/production has NOT been touched** —
production still runs the prior listing-intelligence deploy. The Vercel deployment
for the develop merge was CANCELED by the repo's ignored-build-step, so no
develop/staging deploy ran. **Migration `20260613020000_price_comp_v2_fields` is
still NOT applied to any database.** ⚠️ Before any production deploy (promoting
`develop` → `main`), run `npm run db:deploy` against the **production** DB FIRST —
Vercel may auto-deploy `main`, and the new PriceComp columns must exist before the
app serves traffic against them. This entry is a docs-only commit on `develop`; no
merge to `main`, no deploy. Gate re-run green: `npm run lint` (2 pre-existing
`_m`/`_f` warnings), `npx tsc --noEmit`, `npm test` (357 passed), `npx prisma
validate`, `npm run build`. Build/feature details below.

## Previous update
2026-06-12 — Claude. **PriceComp v2 built on `feature/price-comp-v2` (merged to
develop on 2026-06-13; see above).** Additive migration
`20260613020000_price_comp_v2_fields` adds enums `CompSourceType`/`CompStatus` and
PriceComp columns (sourceType, platform, status, brand, size, currency,
totalPriceCents, imageUrl, matchScore, usedInPricing, ignoredAsOutlier, rawJson);
FK + RLS unchanged; existing manual comps backfill via defaults and still
calculate. Pricing module (`src/lib/pricing/comps.ts`) rewritten: **median is the
anchor** (quick = median×0.9, list = median×1.1), excludes usedInPricing=false /
ignoredAsOutlier=true, prefers sold comps when ≥2 exist, returns confidenceScore +
confidenceReasons + sold/active/comp counts (average still returned). New
`src/lib/pricing/summarize.ts` maps DB rows → pricing. New
`PATCH`/`DELETE /api/listings/comps/[compId]` with seller-ownership checks; POST
persists the v2 fields. Comps panel split into pure `PricingRecommendationCard` +
`CompsTable` (`src/app/comps-pricing-view.tsx`) + the client container; adds
platform/status selectors, edit, delete, use-in-pricing + outlier toggles, a
median tile, sold/active counts, and confidence reasons. Five env-gated provider
stubs (Apify eBay sold, Grailed sold, Poshmark sold, Depop active, Google Lens)
registered in `src/lib/comps/registry.ts`; all return [] until keys are set.
Gate green: `npm run lint` (2 pre-existing `_m`/`_f` warnings), `npx tsc --noEmit`,
`npm test` (356 passed), `npx prisma validate`, `npm run build`. **Migration NOT
applied to any DB** — owner runs `npm run db:deploy` through develop→main before
deploy. `totalPrice` is stored as cents (`totalPriceCents Int?`) to match the
codebase's money convention. Plan:
`docs/superpowers/plans/2026-06-12-price-comp-v2.md`. Owner next: review the branch,
approve develop→main flow, apply the migration to the DB, then deploy.

## Previous update
2026-06-10 — Claude. **Listing intelligence milestone shipped** (main @
`2a829f2`, deployed to sello.wtf). New `src/lib/listing/intelligence.ts`:
item-type + department detection, deterministic eBay category inference
(9 EBAY_US fashion categories, honest high/medium/low/none confidence; saved
override always wins; ambiguity yields suggestions, never auto-fill),
measurement profiles (shoes/tops/bottoms/outerwear/dress/bag/accessory/other).
Dry run now resolves the category itself and blocks with "Choose an eBay
category" + clickable suggestions (persisted via marketplaceDrafts.ebay.
categoryId through the normal draft save flow) instead of a raw ID error;
still zero outbound calls; production publish still hard-locked. Editor
measurements section gives profile-aware guidance ("Add recommended fields";
footwear: shoe size is the size). Copy/export: only filled measurements
render; apparel without them says "Measurements available upon request.";
shoes/bags/accessories get no garment filler; missing size never renders as
a dash. `docs/SELLO_ROADMAP.md` added (completed-product architecture +
fewest-possible-questions principle). 319 tests green. Next per roadmap:
eBay required aspects in preflight, then the deliberate production publish
unlock.

## Previous update
2026-06-10 — Claude. **eBay production publish preflight (dry run) shipped**
(main @ `7f7a2ac`, deployed to sello.wtf). Production readiness is fully green
(owner created the ship-from location). New `preflight.ts` validates a listing
with the same readiness rules + payload mappers as the real publish flow and
returns a payload preview (SKU, inventoryItem, offer, step order) with ZERO
outbound calls (no token, no client, no fetch — test-asserted). New route
`POST /api/listings/[id]/ebay-preflight`; listing editor gets an "eBay publish
dry run" card (connection state, "production publishing disabled" notice,
plain-language blockers, payload preview). publish.ts untouched; production
publish hard-lock intact; sandbox unchanged. 297 tests green. Owner next: run
the dry run on a real listing; the result tells us what production publish
needs before we deliberately unlock it.

## Previous update
2026-06-10 — Claude. **In-app eBay inventory location setup shipped** (main @
`d2b2241`, deployed to sello.wtf). Owner's readiness refresh showed only
`inventory_location` missing (policies ready). eBay has no Seller Hub UI for
Inventory API locations, so /settings/marketplaces now shows a setup form
(US address, Zod-validated) that POSTs /api/marketplaces/ebay/locations →
eBay POST /sell/inventory/v1/location/sello-default-location, then auto
re-runs readiness. eBay 4xx → actionable 422 with eBay's message. Dead
"Seller Hub settings" link replaced with /sh/ovw. Publishing still
hard-disabled. 286 tests green. Owner next: fill in the ship-from address
form on sello.wtf/settings/marketplaces; expect readiness to flip to Ready.

## Previous update
2026-06-10 — Claude. **Readiness 502 hotfix deployed** (main @ `33f1bde`).
Root cause: eBay Account API answers 4xx for sellers not opted into business
policies; the client converted every non-OK response into EBAY_API_FAILED 502,
so Refresh Readiness 502'd with a generic message. Now: per-call 4xx → missing
readiness items (200, structured); eBay 401 / revoked refresh token → typed
EBAY_RECONNECT_REQUIRED state (200, "reconnect" UI message, reconnectRequired
flag on EbayReadinessResponse); only real eBay 5xx → 502 with upstream status
in the message. Production publishing untouched (still hard-disabled; test
asserts it). 278 tests green. Owner verifies by clicking Refresh Readiness on
sello.wtf/settings/marketplaces; expect setup-incomplete with missing policy
items, no inline error.

## Previous update
2026-06-10 — Codex. Completed authenticated production smoke on
https://sello.wtf with the owner's signed-in Chrome session. Dashboard and
Inventory rendered; visible Inventory showed one real ready item. Listing editor
rendered photos, Basics, Measurements, Flaws, Pricing, readiness, Marketplaces,
and copy-only export card. Temporary "Smoke test" measurement and flaw rows each
autosaved, survived reload, were deleted, autosaved again, and were absent after
final reload. Copy buttons for Depop/Poshmark/Grailed all copied text and showed
warning banners, but the only visible item is a sneaker with no size and no
measurements; exports warned `Missing size` / `Draft has not been approved yet`,
had no Measurements section, and Poshmark therefore did not satisfy the requested
Measurements section check. Depop ended in hashtags; Poshmark had no hashtags.
Settings rendered, but Settings -> Marketplaces auto-refresh produced a
production `POST /api/marketplaces/ebay/readiness` 502 and inline
`Error: eBay API request failed.` No Sello-origin browser console errors were
seen; only an unrelated Chrome extension `ethereum` injection error appeared.
No app code changed; HANDOFF only.

## Previous update
2026-06-10 — Codex. Production eBay OAuth now returns to Sello, but the
settings page was showing all readiness items as missing from stored/default
readiness only: production Vercel logs after callback showed
`GET /api/marketplaces/ebay/readiness` 200 and no POST refresh call, so the app
had not actually queried eBay Account/Inventory APIs after consent. Added a
one-shot auto-refresh after connected readiness with no `checkedAt`, clarified
the connected-but-incomplete UI, changed connected actions so primary Connect is
hidden and Reconnect is secondary, and added tests for production API/token use
plus setup-required copy. Production publishing remains disabled. Local gate
passed: `npm run lint` (2 existing warnings in
`src/app/api/listings/draft/draft-actions.test.ts`), `npx tsc --noEmit`, `npm
test` (266 passed), `npx prisma validate`, `npm run build`.

2026-06-10 — Claude. **Production eBay OAuth invalid_request RESOLVED.** Root
cause: `EBAY_REDIRECT_URI_NAME` held a truncated RuName missing the
eBay-username prefix (`JacobHel-sello--zdvqgoeck` instead of
`Jacob_Heller-JacobHel-sello--zdvqgoeck`). Owner supplied the exact portal
value; env var updated in Vercel Production, redeployed, and the server-built
authorize URL verified to land on signin.ebay.com (consent flow) instead of
errorOauth. Temporary diagnostics route removed. Also committed the Codex
README refresh that was left uncommitted on develop. Owner's next step:
sign in on sello.wtf → Settings → Connect eBay → complete eBay consent.

2026-06-10 — Codex. Replaced `README.md` on `develop` with the owner-provided
`/Users/jheller/Downloads/README_new.md` draft, reframing the project as Sello
and documenting current product status, setup, eBay guardrails, deployment,
security, roadmap, and development rules. Docs-only change; no commit, push, or
deploy. Verification gate passed after the README update: `npm run lint`
(2 existing warnings in `src/app/api/listings/draft/draft-actions.test.ts`),
`npx tsc --noEmit`, `npm test` (260 passed), `npx prisma validate`,
`npm run build`.

## Previous update
2026-06-10 — Claude. **Production Connect eBay fails with invalid_request: root
cause is the RuName value.** Evidence (via temporary masked diagnostics route
`/api/marketplaces/ebay/oauth-diagnostics` + direct probes of auth.ebay.com):
authorize URL structure is correct; a bogus client_id yields
`unauthorized_client` while the real one yields `invalid_request`, so the App
ID is valid; the configured `EBAY_REDIRECT_URI_NAME`
(`JacobHel-sello--zdvqgoeck`, note the double dash) errors identically to a
nonexistent RuName → it does not match any RuName on the production keyset.
**Blocked on owner:** copy the exact production RuName from developer.ebay.com
(User Tokens → "Get a Token from eBay via Your Application" → eBay Redirect URL
name), confirm its "auth accepted URL" is
`https://sello.wtf/api/marketplaces/ebay/callback`, update
`EBAY_REDIRECT_URI_NAME` in Vercel Production, redeploy. Also shipped:
env-aware labels on /settings/marketplaces ("Production account"/"Connect eBay"
in production; sandbox wording only in sandbox), main @ `ea2d10a` deployed.
Remove the diagnostics route once connect reaches eBay login.

2026-06-09 — Claude. **Production eBay OAuth enabled and deployed** (main @
`1892879`, sello.wtf); EBAY_ENV accepts "production", publishing stays hard
sandbox-locked, all production eBay env vars set in Vercel (Sensitive/write-only;
EBAY_TOKEN_ENCRYPTION_KEY and EBAY_OAUTH_STATE_SECRET generated fresh,
EBAY_ENV=production via CLI). Then merged feature/ui (copy-text export +
structured measurements/flaws, incl. migration
`20260609120000_add_draft_measurements_flaws`) and feature/settings-landing
(settings landing page; sidebar gear no longer signs users out) into develop,
promoted to **main @ `0991f08` and deployed to production** (sello.wtf, all
routes verified live). Migration `add_draft_measurements_flaws` was applied to
the prod DB via `npm run db:deploy` BEFORE the deploy, as required. Owner's
next step: sign in on sello.wtf → Settings → Connect eBay and complete consent
on auth.ebay.com.

## Current state
- Repo `resale-crosslister`. Production: https://sello.wtf (Vercel project
  `jaky/resale-crosslister`). Current production deployment is
  `dpl_77sDj5cK3VhkLyH25xp6zBWnGU6J` from commit
  `977fe7ccf891b98d95b3bb8ecb72f8926f198708`, aliased to
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
- PR #66 paid-beta bulk visibility and StockX readiness hardening is merged to
  `develop` and deployed to production. It adds client-visible plan bulk limits,
  over-limit blocking before bulk publish/delist work, stricter StockX
  env-readiness posture, and a bulk delist preflight plan-cap fix. It does not
  enable any live StockX listing path.
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
- StockX foundation is deployed but remains fail-closed: live listing creation is
  disabled, bulk StockX publishing does not exist, StockX is excluded from the
  autonomous publish queue, and API/market-data/listing flags remain disabled
  unless explicitly approved.
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
  (manual Refresh enabled; draft auto-discovery disabled by cost/quality
  decision).
- T1–T7 (lifecycle mark-sold/delist, responsive layout, auto-fetch comps, inventory
  grid/sort/pagination, photo set-cover, consistent loading/error states, tests).
- eBay account-deletion compliance endpoint (deployed, but **env not set yet** — see Blocked).

## Recent work (newest first)
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
- **Authenticated production smoke:** Owner/admin checkout-open, non-admin
  member-denial, authenticated `/api/capabilities`, and authenticated bulk
  plan-limit UI paths need an authenticated production seller session/token to
  exercise live. The PR #66 production pass did not ask for credentials and did
  not complete a real payment; route/UI policy is covered by tests.
- **Preview StockX env values:** Vercel Preview has the safe StockX flag/base
  names but is missing `STOCKX_CLIENT_ID`, `STOCKX_CLIENT_SECRET`, and
  `STOCKX_API_KEY`. Add only through Vercel/secure channel if Preview StockX
  OAuth/API smoke is needed; never print values.
- **Migration status in this shell:** `DATABASE_URL` and `DIRECT_URL` are absent
  here, so `npx prisma migrate status` cannot run locally. Use the approved DB
  context only; do not create or paste DB URLs into chat/logs.
- **Real paid checkout:** do not complete a live Stripe checkout unless the
  operator explicitly approves and uses an operator-owned payment method.
- **Live marketplace publishing:** do not bulk-publish or live-publish real
  marketplace listings unless explicitly approved for a controlled window.
- **StockX live API/listing flags:** keep `STOCKX_API_ENABLED`,
  `STOCKX_MARKET_DATA_ENABLED`, and `STOCKX_LISTING_ENABLED` disabled unless the
  operator explicitly approves a controlled enablement.
- **Live eBay publishing:** `EBAY_PUBLIC_IMAGE_BUCKET` is now configured and
  derivative preflight passed, but keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent
  unless the owner explicitly approves another controlled live run.
- **Comp provider spend/quality:** Apify eBay sold comps are live only for
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
1. Monitor production after the billing performance/navigation deploy
   (`dpl_77sDj5cK3VhkLyH25xp6zBWnGU6J`) for any delayed runtime errors, but
   initial error/fatal/500 log filters were clean.
2. If an authenticated production owner session is available, run a
   non-destructive seller smoke for plan/quota visibility, authenticated
   `/api/capabilities`, bulk over-cap UI blocking, owner/admin checkout-open
   without payment completion, Free portal safety, and StockX disabled/status/
   connect posture.
3. Review and merge `feature/comp-confidence-cost-controls`, then deploy and
   revalidate manual Refresh before considering draft auto-discovery again.
4. Keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent until an explicitly approved
   controlled live eBay run.
5. Before a live eBay run, rerun authenticated eBay readiness/preflight in the
   UI and verify the public derivative row is reused for the target item.
6. Continue security follow-ups: externalUserId binding, real eBay deletion
   notification validation, key rotation, npm audit items, RLS hardening.
7. Stripe subscriptions and background worker host + inventory sync.

## Resume checklist
1. `cd "/Users/jheller/Desktop/perc 30/worktrees/ui"` (the `feature/ui` worktree).
2. `git fetch && git merge origin/develop` (stay current); `npm install`; `npx prisma generate`.
3. Gate: `npm run lint && npx tsc --noEmit && npm test && npm run build`.
4. Flow: `feature/* → develop → main → production`. Commit + merge to `develop`. **Never push `main` or deploy to production without explicit owner approval.** Preview deploys are fine on request.

## Key gotchas
- **Next.js 16**: read `node_modules/next/dist/docs/` before writing Next code; `params`/`searchParams` are async; use `next/font`.
- **ESLint `react-hooks/set-state-in-effect` is an error**: do data fetching in an async function defined *inside* the effect; trigger refetches via a `reloadKey` state, not by calling a setState-bearing `useCallback` in the effect.
- **DB env**: runtime reads `DATABASE_URL` (the `resale_app` pooler role); don't switch to the postgres owner. Vercel also injects `POSTGRES_*` — keep `DATABASE_URL` set explicitly. `getRequiredEnv()` rejects any value containing `[`.
- **Integrity**: never fake publishing/comps; never invent prices; no secrets in code/logs/this file; scope every query to the seller.

---

# Inventory safety layer (double-sell prevention) — feat/marketplace-safety-layer

Pre-paid-customer marketplace safety layer, Part 1 (core). Built in an isolated
worktree off develop; additive only; existing eBay/Etsy/export behavior unchanged.

## What was built (validated, landed)
- Source-of-truth inventory model + idempotent double-sell engine.
- Email-signal ingestion MVP (parser + fail-closed endpoint).
- Manual action routes (mark sold / add marketplace URL / resolve review task).

## Tables added/changed (migration 20260626000000_inventory_safety_layer)
- InventoryItem +: quantityAvailable, soldSourceMarketplace, soldSourceListingId,
  lockVersion (optimistic concurrency).
- MarketplaceListing +: externalUrl, titleSnapshot, skuSnapshot, metadata, endedAt;
  status enum +ENDED/UNKNOWN/NEEDS_REVIEW/SUBMITTED_FOR_AUDIT/REJECTED.
- New: InventoryEvent, ReviewTask, SyncJob (idempotencyKey FULL unique), EmailSignal
  (providerMessageId unique), Notification. RLS enabled, no policies (resale_app
  BYPASSRLS pattern). NOT applied to any DB.

## Sync-job worker / executors (src/lib/inventory-sync/jobs/worker.ts)
- Pure, db-injectable (default getPrisma()) like the engine. Entrypoints:
  claimQueuedSyncJobs(db,{limit}), runSyncJob(db,jobId,deps), runQueuedSyncJobs(db,{limit}).
- Claim is atomic: a conditional updateMany(where:{id,status:'queued'}) — count===1
  means this worker won; two workers can NEVER both claim. Limit caps at 25 (default 10).
- maxAttempts is enforced: a delist that FAILS at attempts>=maxAttempts ends terminal
  'failed' (never re-queued); endless retry is impossible. All error text is scrubbed
  via safeFailureText before being persisted to job/event/task.
- delist_marketplace_listing: ownership-scoped load; missing/already-terminal listing
  => 'succeeded' (no-op); sold-source listing => 'skipped'; eBay => the EXISTING
  executeEbayDelist (CALLED, not reimplemented) then endedAt + delist_succeeded +
  'succeeded'; on error => delist_failed event + manual_delist_required task +
  'needs_review' (or 'failed' if attempts exhausted). Non-eBay is defensive only:
  NEVER fakes a delist — parks a manual task + 'needs_review'.
- notify_user: createNotification + notification_sent event once (deduped by unread
  user+kind+inventoryItemId+title); invalid payload => 'failed'. Nothing enqueues
  these yet (forward use).
- create_review_task: createReviewTask (dedupes open tasks) => 'succeeded'.
- FAIL CLOSED (no executor yet): detect_status, mark_sold, update_inventory_quantity,
  update_price, sync_order => 'skipped' + errorCode 'NOT_IMPLEMENTED'. They do NOT
  silently succeed and invent no marketplace API calls. TODO (next): implement each
  against the real provider APIs (no invented endpoints), keep them fail-closed behind
  the per-marketplace adapter/enablement flags, and only then flip from 'skipped' to a
  real executor. Order/quantity/price sync also need the inbound polling source first.

## Stale-running reaper (ops hardening, PR #61)
- `requeueStaleRunningSyncJobs(db, { olderThanMinutes, limit }): Promise<{ requeued; failed }>`
  in `src/lib/inventory-sync/jobs/worker.ts`. Same db-injectable pattern as the rest
  of the worker (default `getPrisma()`); fully unit-tested with the in-memory fake.
- Why: a worker that crashes mid-run leaves a SyncJob in 'running' that never reaches
  a terminal status and would otherwise sit forever. The reaper recovers them.
- Behavior: cutoff = now - olderThanMinutes. Finds `status='running' AND updatedAt <=
  cutoff`, ordered by updatedAt asc, bounded by `take: limit` (limit clamped to max 25,
  default 10). For each:
  - `attempts < maxAttempts` => REQUEUE via a RACE-SAFE conditional
    `updateMany({ where:{ id, status:'running' }, data:{ status:'queued', runAfter: now } })`.
    count===1 => requeued++. **attempts is NOT reset** (the original claim already
    counted it). Creates NO event/task/notification (status change only — never
    duplicates side effects).
  - `attempts >= maxAttempts` => FAIL terminal via
    `updateMany({ where:{ id, status:'running' }, data:{ status:'failed',
    errorCode:'MAX_ATTEMPTS_EXHAUSTED', errorMessage:<safeFailureText> } })`.
    count===1 => failed++. Not requeued. errorMessage is the sanitized generic
    "The job exceeded its maximum attempts." (no raw internals).
- The conditional `status:'running'` guard makes it race-safe against a live worker
  that finishes the same row: that row no longer matches, count===0, it is skipped.
- `staleOlderThanMinutes` is clamped server-side to a safe minimum of 5 and max of
  1440 (default 15) so a tiny/negative window can never requeue freshly-claimed jobs
  that are still legitimately running.

## Worker-route trigger (POST /api/inventory/sync-jobs/run)
- Header (RENAMED): `x-inventory-sync-worker-secret: $INVENTORY_SYNC_WORKER_SECRET`
  (was `x-internal-secret`). 503 if env unset, 401 on mismatch, timing-safe compare.
- Body (all optional; empty body works; present-but-malformed JSON => 400):
  `{ "limit": 10, "requeueStale": true, "staleOlderThanMinutes": 15 }`.
  When `requeueStale` is true the reaper runs FIRST (clamped minutes + bounded limit),
  THEN `runQueuedSyncJobs`, so recovered jobs are re-claimed in the same invocation.
  When false: `requeuedStale=0, failedStale=0`.
- Response (sanitized counts only — NEVER payloads/provider errors/secrets):
  `{ ok:true, requeuedStale, failedStale, claimed, succeeded, failed, skipped, needsReview }`.

## Scheduler decision (NO Vercel cron)
- DECISION: do NOT add `vercel.json` cron and do NOT add a GET handler.
  Reasons: (1) the repo has no existing safe cron-route / CRON_SECRET pattern to reuse;
  (2) Vercel Cron can only issue `GET` + `Authorization: Bearer $CRON_SECRET` — no
  custom header, no POST body — so it cannot authenticate this POST + custom-header
  endpoint without weakening the auth model, which we will not do.
- Use an EXTERNAL scheduler (GitHub Actions cron / Upstash QStash / any cron service):
  - POST to `https://<app-domain>/api/inventory/sync-jobs/run` every 5-10 minutes.
  - Header: `x-inventory-sync-worker-secret: $INVENTORY_SYNC_WORKER_SECRET`
  - Body: `{"limit":10,"requeueStale":true,"staleOlderThanMinutes":15}`
  - Keep the secret in the scheduler's secret store, never in the repo.

## Endpoints added
- POST /api/inventory/email-signals  (x-internal-secret, fail-closed)
- POST /api/inventory/sync-jobs/run   (x-inventory-sync-worker-secret, fail-closed;
  worker trigger; optional {limit, requeueStale, staleOlderThanMinutes}; returns ONLY a
  sanitized summary {requeuedStale,failedStale,claimed,succeeded,failed,skipped,
  needsReview}; not public-user callable)
- POST /api/inventory/mark-sold
- POST /api/inventory/listings        (manual marketplace URL)
- POST /api/inventory/review-tasks/[id]/resolve

## Lifecycle bridge (double-sell gap closed)
- POST /api/listings/lifecycle action 'mark_sold' now routes through the engine
  (markItemSold) instead of a bare SOLD flip, so OTHER active listings are queued for
  delist. The marketplace is unknown for a manual action: markItemSold /
  queueDelistOtherListings now accept soldMarketplace: Marketplace | null — null =
  "source unknown" => soldSourceMarketplace=null and delist EVERY active listing (skip
  none). Auth (401), ownership (404), and canTransition (409) behavior preserved; the
  existing { inventoryItem } response shape is kept (re-read after the engine call).
  The 'delist' action is unchanged.

## Env vars
- INVENTORY_EMAIL_INGEST_SECRET (server-only). Unset => /api/inventory/email-signals
  returns 503; wrong x-internal-secret => 401 (timing-safe compare).
- INVENTORY_SYNC_WORKER_SECRET (server-only). Unset => /api/inventory/sync-jobs/run
  returns 503; wrong `x-inventory-sync-worker-secret` header => 401 (timing-safe compare).

## Automated vs manual
- Automated: high-confidence sale signal -> mark sold -> queue delist for other
  platforms -> notify. eBay delist enqueued via the existing adapter path; all
  non-eBay marketplaces create a manual_delist_required review task with URL +
  instructions.
- Manual: medium/low-confidence signals create review tasks only (never auto-
  delist). Manual mark-sold and add-URL via the routes above.

## Marketplace keys
- vinted / stockx / tiktok_shop were ALREADY present (enum, registry, capability
  matrix, labels, tests — PR #59). They ALREADY fail closed via the stub adapter
  (NOT_IMPLEMENTED). No live calls exist for them.

## Known limitations / NOT done this pass (sequenced next steps)
- TikTok Shop full native integration (auth/signing/products/orders/webhooks):
  DEFERRED. Must be implemented against official TikTok Shop API docs (no invented
  endpoints) and stay fail-closed behind TIKTOK_SHOP_ENABLED. Today TikTok is a
  fail-closed stub, which satisfies "block live calls unless enabled".
- Part 3 pricing tiers (Free/Pro/Kingpin, usage metering, seats): OWNED BY THE
  CONCURRENT BILLING BRANCH (src/lib/billing/* on security/rls-least-privilege),
  which already implements the plan catalog/entitlements/usage and is wired into
  draft/publish/bulk routes. NOT rebuilt here to avoid a destructive conflict. The
  safety engine is tier-agnostic; gate its automation (auto-delist / sold
  detection) behind billing entitlements (fullInventorySync/autoDelist/
  soldDetection) when that branch merges. Until then, gated automation should fall
  back to manual review tasks (the engine already creates them).
- Inventory sync UI (platform chips, sync panel, buttons), notifications UI, and
  the order-sync/webhook consumers: DEFERRED.
- Migration is NOT applied; apply via the documented Supabase path after develop merge.
- Worker scheduling is EXTERNAL (no in-repo cron). Until an external scheduler is
  configured (see "Scheduler decision"), the reaper + worker only run when something
  POSTs the route. No background loop ships in the app.

## Validation (in worktree)
- Inventory safety layer (earlier pass): prisma validate pass; tsc clean; lint 0
  errors (2 pre-existing warnings); 163 files / 1094 tests; next build success.
- Ops-hardening pass (PR #61, 2026-06-25): `prisma validate` pass; `tsc --noEmit` 0;
  `npm run lint` 0 errors / 2 pre-existing warnings (`draft-actions.test.ts`, unrelated);
  `npm test` 166 files / **1140 tests pass** (baseline was 1129; +11 new reaper/route
  tests); `next build` success. No eBay/billing/auth/UI files modified; no secrets in
  code/logs/tests; migration `20260626000000_inventory_safety_layer` untouched/unapplied.

## Risks
- resale_app BYPASSRLS: isolation depends on app-layer userId filters (engine
  enforces them; keep that invariant).
- Email parser is heuristic; only HIGH-confidence + exact match auto-acts, all else
  -> review task (by design, to avoid wrong auto-delist).

---

# Stripe billing / account-scope PR checkpoint (2026-06-26)

- Branch: `feature/stripe-billing-metering-seats`
- PR: https://github.com/g4m35/resale-crosslister/pull/62 -> `develop`
- Branch was rebased onto latest `origin/develop`; one additive Prisma schema
  conflict was resolved by retaining both inventory-safety models and billing
  account/subscription/usage models.
- Review fix commit added after PR open:
  `fix(billing): preserve account scope in mark-sold flows`
  - `/api/inventory/mark-sold` now authorizes by active account before calling
    the safety engine.
  - Lifecycle `mark_sold` passes creator `sellerId` as the inventory-owner guard
    while preserving signed-in user as actor/audit id.
- Review findings addressed in progress:
  - Owner/admin account-management guard added for member invites.
  - Owner/admin account-management guard added for Stripe portal sessions.
  - Duplicate pending invites are reused, and duplicate login-time invite
    acceptance revokes the extra pending invite when the user is already active.

## Latest local validation before review-fix push
- `npx prisma validate`: pass
- `npm run lint`: pass, 0 errors / same 2 pre-existing warnings in
  `src/app/api/listings/draft/draft-actions.test.ts`
- `npm test`: pass, 187 files / 1252 tests
- `npm run build`: pass
- `git diff --check`: pass
- Focused review-fix tests after guard/idempotency edits:
  4 files / 30 tests pass

## External status at checkpoint
- Branch pushed to origin.
- PR opened.
- Vercel status reported success, but build was ignored by the configured Vercel
  ignored-build step.
- Supabase Preview skipped because there were no `supabase` directory changes.
- Vercel Agent Review skipped because of insufficient credit.
- CodeRabbit remained pending with only its in-progress comment at the time of
  this checkpoint.
- Codex review produced three actionable findings; all are being fixed before
  merge.

---

# StockX foundation / production-readiness checkpoint (2026-07-01)

- Branch: `feature/stockx-foundation-bulk-safety-release`
- StockX callback URL used by config and Vercel defaults:
  `https://sello.wtf/api/marketplaces/stockx/callback`
- Implementation added a fail-closed StockX foundation:
  OAuth connect/callback/disconnect/status, encrypted token storage in the existing
  account-scoped `MarketplaceConnection`, catalog search normalization, listing-draft
  product/variant matching, StockX paid market-data comp source, settings UI, listing
  editor match UI, and disabled listing placeholder route.
- New migration:
  `20260701010000_stockx_foundation` adds only nullable StockX match metadata fields
  on `ListingDraft` plus indexes. The existing marketplace token table is reused.
- Vercel env state checked by name only:
  - Production and Preview (`develop`) now have non-secret defaults:
    `STOCKX_REDIRECT_URI`, `STOCKX_API_BASE_URL`, `STOCKX_AUTH_BASE_URL`,
    `STOCKX_API_ENABLED=false`, `STOCKX_MARKET_DATA_ENABLED=false`,
    `STOCKX_LISTING_ENABLED=false`.
  - Production and Preview (`develop`) now have generated app-owned secrets:
    `STOCKX_TOKEN_ENCRYPTION_KEY`, `STOCKX_OAUTH_STATE_SECRET`.
  - The linked Vercel project did not list `STOCKX_CLIENT_ID`,
    `STOCKX_CLIENT_SECRET`, or `STOCKX_API_KEY` by name during this pass. No values
    were printed.
- StockX OAuth/live API status:
  disabled by default because `STOCKX_API_ENABLED=false` and required app credentials
  / API key are not visible by name in the linked Vercel project. Catalog search and
  market data fail closed until the flags and env are complete.
- Intentionally disabled:
  live StockX listing creation, future listing/order sync, and any bulk StockX
  publishing. `stockx` remains excluded from the autonomous publish queue.
- Bulk publishing safety validation:
  registry tests assert StockX is not publish-queue eligible; the new StockX publish
  route returns disabled/future-readiness errors and performs no marketplace mutation.
- Migration-ledger readiness:
  prior read-only Supabase production check found the billing/account-scope schema
  present but `_prisma_migrations` missing the exact required billing migration names
  (`20260625010000_add_billing_models`,
  `20260625020000_inventory_account_scope`,
  `20260625030000_marketplace_connections_account_scope`). Treat production deploy as
  blocked until that ledger mismatch is reconciled or formally documented.
- Validation after this pass:
  `npx prisma validate` pass; `npm run lint` pass with the same two pre-existing
  `draft-actions.test.ts` warnings; `npm test` pass (199 files / 1295 tests);
  `npm run build` pass; `git diff --check` pass.
- Secret handling:
  no `.env*` files changed, no StockX credential values printed, and no secrets added
  to repo docs/tests/source.

## Follow-up release-readiness pass (2026-07-01)

- Branch was rebased against `origin/develop`; no rebase changes were needed.
- Vercel StockX env status, checked redacted:
  - `vercel env ls` shows production names present for:
    `STOCKX_API_KEY`, `STOCKX_REDIRECT_URI`, `STOCKX_API_BASE_URL`,
    `STOCKX_AUTH_BASE_URL`, `STOCKX_API_ENABLED`,
    `STOCKX_MARKET_DATA_ENABLED`, `STOCKX_LISTING_ENABLED`,
    `STOCKX_TOKEN_ENCRYPTION_KEY`, `STOCKX_OAUTH_STATE_SECRET`.
  - `vercel env ls` still shows misnamed production credential names:
    `StockX_client_id`, `StockX_client_secret`.
  - Exact production names `STOCKX_CLIENT_ID` and `STOCKX_CLIENT_SECRET` are
    still missing. The misnamed values are not retrievable via `vercel env pull`
    / `vercel env run` in this CLI context, so they must be re-entered under the
    exact uppercase names by an operator. No credential values were printed.
  - `STOCKX_API_ENABLED`, `STOCKX_MARKET_DATA_ENABLED`, and
    `STOCKX_LISTING_ENABLED` were updated through Vercel CLI and verified as
    fail-closed in the production runtime env (`!== "true"`). StockX live API,
    market data, and listing creation remain disabled.
- Read-only production migration ledger query was run through Supabase MCP against
  project `xkovtxrdxparbkuysunh`:
  - Present latest ledger entries include
    `20260624000000_add_tiktok_vinted_stockx_marketplaces`,
    `20260625000000_rls_least_privilege_hardening`, and
    `20260626000000_inventory_safety_layer`.
  - Still missing by exact name:
    `20260625010000_add_billing_models`,
    `20260625020000_inventory_account_scope`,
    `20260625030000_marketplace_connections_account_scope`.
  - New branch migration `20260701010000_stockx_foundation` is not applied to
    production. Production deploy remains blocked until the migration ledger is
    reconciled/documented and the StockX migration is applied through the
    approved production path.
- Bulk publish/delist safety audit result:
  - Bulk publish and delist routes authenticate the user, resolve the active
    account server-side, enforce plan batch caps, and pass `userId` separately
    from `accountId` into service execution.
  - Services re-check item membership with active `accountId` before readiness,
    publish, or delist work; client-supplied account ids are not accepted.
  - Bulk publish preflight uses canonical eBay preflight; execution calls
    single-item `executePublish`, preserving eBay readiness, production gate,
    duplicate publish guard, idempotency key, and structured per-item results.
  - Bulk delist preflight and execution route through canonical eBay delist logic,
    preserving already-ended/in-flight/idempotency checks and structured per-item
    results.
  - `stockx` remains excluded from autonomous publish queue; no bulk StockX
    publishing exists.
- Additional tests added in this pass:
  - Free/Pro/Kingpin bulk publish plan cap behavior.
  - Over-cap batch blocks before marketplace service call.
  - Active account and acting user are forwarded separately for bulk publish/delist.
  - Account-scoped item rejection happens before readiness/listing classification.
  - Revoked membership is not returned by `getActiveAccount`.
  - Focused validation: 8 files / 70 tests passed.
