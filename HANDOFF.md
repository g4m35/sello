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
2026-06-09 — Claude. Built the copy/paste listing export feature (Depop,
Poshmark, Grailed) on `feature/ui`: pure formatters, seller-scoped
`GET /api/listings/[id]/export?marketplace=…`, a "Copy listing text" card on the
listing detail page, 19 new tests. Gate green (232 tests, lint, tsc, prisma
validate, build). Committed on `feature/ui`; **not pushed, no PR opened** (owner
decides when to push/merge).

## Current state
- Repo `resale-crosslister`. Production: https://sello.wtf (Vercel project `jaky/resale-crosslister`), `main` @ `27b7151`.
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
- 2026-06-09 (Claude): copy/paste listing export for Depop/Poshmark/Grailed on `feature/ui` (unpushed). Pure formatters in `src/lib/marketplace/export-formatters.ts`, route `GET /api/listings/[id]/export?marketplace=…` (typed `{marketplace, title, body, warnings}`; 400 bad marketplace, 401, 404 cross-seller), "Copy listing text" card on `/inventory/[id]` with per-marketplace copy buttons + warning banner. Honest copy-only: no publishing claimed. Measurements/flaws come from draft `itemSpecifics` key matching (no structured fields exist yet — see Next up).
- 2026-06-09 (Claude): promoted develop -> main (PR #25) and deployed to production (main @ 27b7151, sello.wtf). All prior develop work now live. Account-deletion GET still returns 500 in prod until its env vars are set.
- 2026-06-09 (Claude): eBay account-deletion compliance endpoint `/api/marketplaces/ebay/account-deletion` (GET challenge hash, POST ack + best-effort connection purge + JobLog audit) + tests.
- 2026-06-09 (Claude): removed eBay Marketplace Insights source (eBay restricted access); StockX is now primary sold-comp path.
- 2026-06-09 (Claude): reframed CLAUDE.md/AGENTS.md for the full product (dropped MVP scope caps; kept integrity + deploy-safety).
- 2026-06-09 (Claude): T1–T7 autonomous batch on develop (see above).
- 2026-06-08 (Claude): Phase 0 + Phase 1 built, verified, deployed to prod; magic-link + env-config fixes; comps pipeline.

## Blocked on owner (credentials / decisions — not code)
- **Comp source key** (to light up automatic pricing): `STOCKX_API_KEY` (primary sold, needs partner approval), or `EBAY_BROWSE_CLIENT_ID`/`EBAY_BROWSE_CLIENT_SECRET` (interim active, prod keyset), or a third-party aggregator key. Add in Vercel env.
- **eBay production publishing access** (keyset + RuName/OAuth) for real publishing.
- **Stripe keys** for monetization.
- **Worker host** (Railway/Render/Fly, or Vercel Cron) for queues + inventory sync.
- **`.env.example`**: still needs the two `EBAY_MARKETPLACE_DELETION_*` lines (agents are sandbox-blocked from editing env files; owner adds them).
- **Account-deletion go-live**: set `EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN` (owner-chosen, 32–80 chars) and `EBAY_MARKETPLACE_DELETION_ENDPOINT` (= `https://sello.wtf/api/marketplaces/ebay/account-deletion`) in Vercel Production, deploy, then register URL + token in the eBay developer portal.

## Next up (priority order)
0. Push `feature/ui` + PR to `develop` for the copy-export feature (when owner asks). Consider adding structured `measurements`/`flaws` fields to the draft model later so exports stop relying on `itemSpecifics` key heuristics.
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
