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
  `jaky/resale-crosslister`). Production code deployment is
  `dpl_8WGo6XPBjUKRdQLMyrKnXF7w3onB` from main commit `ebd91e7`, aliased to
  `https://sello.wtf`; later HANDOFF-only commits may be on top of `origin/main`
  without a production redeploy.
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
- **Live eBay publishing:** `EBAY_PUBLIC_IMAGE_BUCKET` is now configured and
  derivative preflight passed, but keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent
  unless the owner explicitly approves another controlled live run.
- **Comp provider spend/quality:** Apify eBay sold comps are live only for
  manual Refresh. Draft auto-discovery is disabled because the observed cost per
  auto run was about `$0.3641`; keep it disabled until
  `feature/comp-confidence-cost-controls` lands and production manual Refresh is
  revalidated with the lower caps.
- **Stripe keys** for monetization.
- **Worker host** (Railway/Render/Fly, or Vercel Cron) for queues + inventory sync.
- **Security follow-ups:** externalUserId binding, real eBay deletion
  notification validation, key rotation, remaining npm audit items, and RLS
  hardening.

## Next up (priority order)
1. Review and merge `feature/comp-confidence-cost-controls`, then deploy and
   revalidate manual Refresh before considering draft auto-discovery again.
2. Keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent until an explicitly approved
   controlled live eBay run.
3. Before a live eBay run, rerun authenticated eBay readiness/preflight in the
   UI and verify the public derivative row is reused for the target item.
4. Continue security follow-ups: externalUserId binding, real eBay deletion
   notification validation, key rotation, npm audit items, RLS hardening.
5. Stripe subscriptions and background worker host + inventory sync.

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
