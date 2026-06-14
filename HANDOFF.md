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
- Deploy + production verification details appended below once shipped.

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
- Repo `resale-crosslister`. Production: https://sello.wtf (Vercel project `jaky/resale-crosslister`), `origin/main` @ `a45294a` (untouched); `origin/develop` @ `f52b60b` (PriceComp v2 merged, awaiting promotion + `db:deploy`).
- Production eBay OAuth/readiness live; publishing remains sandbox-only by design (hard gate in `publish.ts`). Production publish is the next deliberate build, not a flag flip.
- Latest readiness diagnosis: OAuth is connected, but the deployed auto-refresh now returns `POST /api/marketplaces/ebay/readiness` 502 with `eBay API request failed`; production policy/location missing state is still not proven real until the eBay Account/Inventory API call succeeds.
- `develop` and `main` are effectively level (prod is current). Work in `worktrees/ui` (`feature/ui`).
- Worktrees: `resale-crosslister` → `develop`; `worktrees/ui` → `feature/ui` (active feature work).
- README on `develop` has been refreshed from the owner-provided Sello draft.
- Open PR **#1** (pre-existing "chore: optimize repo workflow") into `develop`.
- CodeRabbit auto-reviews enabled on `develop`.
- Gate on `develop`/`main`: `lint`, `tsc`, `vitest` (266 tests), `prisma validate`, `build` all green.

## Shipped to prod (all live now)
- Full app UI, Phase 0, Phase 1 comps pipeline (dormant — no comp source key).
- T1–T7 (lifecycle mark-sold/delist, responsive layout, auto-fetch comps, inventory
  grid/sort/pagination, photo set-cover, consistent loading/error states, tests).
- eBay account-deletion compliance endpoint (deployed, but **env not set yet** — see Blocked).

## Recent work (newest first)
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
- **Comp source key** (to light up automatic pricing): `STOCKX_API_KEY` (primary sold, needs partner approval), or `EBAY_BROWSE_CLIENT_ID`/`EBAY_BROWSE_CLIENT_SECRET` (interim active, prod keyset), or a third-party aggregator key. Add in Vercel env.
- **eBay production seller setup / readiness refresh**: auto-refresh currently fails against eBay with a production 502 (`eBay API request failed`) before Sello can prove which policy/location items are missing. Investigate the eBay API response/status, scopes, and seller-account readiness; once refresh succeeds, if payment, fulfillment, return policy, or inventory location remain missing, the owner needs to create them in eBay Seller Hub for the connected production seller account, then click Refresh Readiness.
- **eBay production publishing**: code decision + build (OAuth is done; publish gate stays locked until built and approved).
- **Stripe keys** for monetization.
- **Worker host** (Railway/Render/Fly, or Vercel Cron) for queues + inventory sync.
- **`.env.example`**: still needs the two `EBAY_MARKETPLACE_DELETION_*` lines (agents are sandbox-blocked from editing env files; owner adds them).
- **Account-deletion go-live**: set `EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN` (owner-chosen, 32–80 chars) and `EBAY_MARKETPLACE_DELETION_ENDPOINT` (= `https://sello.wtf/api/marketplaces/ebay/account-deletion`) in Vercel Production, deploy, then register URL + token in the eBay developer portal.

## Next up (priority order)
1. Investigate authenticated smoke findings: eBay readiness refresh 502 on `POST /api/marketplaces/ebay/readiness`, and decide whether copy exports should always include a Measurements section even for sneaker items with no measurements.
2. Wire the **StockX comp source** (env-gated by `STOCKX_API_KEY`) following the `CompSource` pattern in `src/lib/comps/`. eBay Browse source already implemented. Stays honest/empty without a key.
3. **Real eBay publishing**: production OAuth consent + Sell Inventory/Offer publish path, replacing the 501 stub, gated on prod eBay credentials.
4. **Stripe subscriptions** (gated on Stripe keys).
5. **Background worker host** + inventory sync (sold detection, double-sell prevention).

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
