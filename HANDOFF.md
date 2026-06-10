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
2026-06-10 — Claude. **Production Connect eBay fails with invalid_request: root
cause is the RuName value.** Evidence (via temporary masked diagnostics route
`/api/marketplaces/ebay/oauth-diagnostics` + direct probes of auth.ebay.com):
authorize URL structure is correct; a bogus client_id yields
`unauthorized_client` while the real one yields `invalid_request`, so the App
ID is valid; the configured `EBAY_REDIRECT_URI_NAME`
(`JacobHel-sello--zdvqgoeck`, note the double dash) errors identically to a
nonexistent RuName → it does not match any RuName on the production keyset.
**Blocked on owner:** copy the exact production RuName from
developer.ebay.com (User Tokens → "Get a Token from eBay via Your
Application" → eBay Redirect URL name), confirm its "auth accepted URL" is
`https://sello.wtf/api/marketplaces/ebay/callback`, update
`EBAY_REDIRECT_URI_NAME` in Vercel Production, redeploy. Also shipped:
env-aware labels on /settings/marketplaces ("Production account"/"Connect
eBay" in production; sandbox wording only in sandbox), main @ `ea2d10a`
deployed. Remove the diagnostics route once connect reaches eBay login.

## Previous update
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
- Repo `resale-crosslister`. Production: https://sello.wtf (Vercel project `jaky/resale-crosslister`), `main` @ `0991f08`.
- Production eBay OAuth/readiness live; publishing remains sandbox-only by design (hard gate in `publish.ts`). Production publish is the next deliberate build, not a flag flip.
- `develop` and `main` are effectively level (prod is current). Work in `worktrees/ui` (`feature/ui`).
- Worktrees: `resale-crosslister` → `develop`; `worktrees/ui` → `feature/ui` (active feature work).
- Open PR **#1** (pre-existing "chore: optimize repo workflow") into `develop`.
- CodeRabbit auto-reviews enabled on `develop`.
- Gate on `develop`/`main`: `lint`, `tsc`, `vitest` (213 tests), `prisma validate`, `build` all green.

## Shipped to prod (all live now)
- Full app UI, Phase 0, Phase 1 comps pipeline (dormant — no comp source key).
- T1–T7 (lifecycle mark-sold/delist, responsive layout, auto-fetch comps, inventory
  grid/sort/pagination, photo set-cover, consistent loading/error states, tests).
- eBay account-deletion compliance endpoint (deployed, but **env not set yet** — see Blocked).

## Recent work (newest first)
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
- **eBay production OAuth consent**: owner must connect their real eBay account on sello.wtf (Settings -> Marketplaces -> Connect eBay) to validate the flow end to end.
- **eBay production publishing**: code decision + build (OAuth is done; publish gate stays locked until built and approved).
- **Stripe keys** for monetization.
- **Worker host** (Railway/Render/Fly, or Vercel Cron) for queues + inventory sync.
- **`.env.example`**: still needs the two `EBAY_MARKETPLACE_DELETION_*` lines (agents are sandbox-blocked from editing env files; owner adds them).
- **Account-deletion go-live**: set `EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN` (owner-chosen, 32–80 chars) and `EBAY_MARKETPLACE_DELETION_ENDPOINT` (= `https://sello.wtf/api/marketplaces/ebay/account-deletion`) in Vercel Production, deploy, then register URL + token in the eBay developer portal.

## Next up (priority order)
1. Wire the **StockX comp source** (env-gated by `STOCKX_API_KEY`) following the `CompSource` pattern in `src/lib/comps/`. eBay Browse source already implemented. Stays honest/empty without a key.
2. **Real eBay publishing**: production OAuth consent + Sell Inventory/Offer publish path, replacing the 501 stub, gated on prod eBay credentials.
3. **Stripe subscriptions** (gated on Stripe keys).
4. **Background worker host** + inventory sync (sold detection, double-sell prevention).

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
