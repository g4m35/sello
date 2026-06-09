# Claude Project Instructions

## Product

An AI-powered resale cross-listing SaaS for streetwear, sneakers, and hype-fashion
sellers. This is a real product being built out toward launch — not a throwaway
MVP. Expanding scope is expected; build complete, production-grade features.

Next.js web app (not mobile-native).

Core workflow (the spine; everything else hangs off it):

1. User uploads item photos.
2. Gemini identifies the product.
3. Gemini generates structured marketplace listing drafts (Zod-validated).
4. User edits and approves the master listing.
5. Automatic pricing from real sold/active comps.
6. Cross-list to marketplaces and keep inventory in sync.

All of cross-listing, real marketplace publishing, automatic comps, inventory
sync, and monetization are now in scope. Build them properly (gated, tested,
honest) rather than stubbing them out.

## Tech Stack

- Next.js (App Router) + TypeScript (strict) + Tailwind v4
- Supabase Auth / Postgres / Storage
- Prisma
- Gemini API (structured JSON output only)
- Zod (validate all external + AI data at boundaries)
- BullMQ + Redis / Upstash (background jobs)
- Marketplace APIs (eBay, StockX, etc.); Playwright only where no official API exists
- Stripe (subscriptions / billing)
- Vercel (hosting)

## Database Notes

- DATABASE_URL intentionally uses the Supabase transaction pooler.
- DIRECT_URL had IPv6/DNS connectivity problems on this machine.
- A dedicated role `resale_app` was created for runtime/app access. Do not switch
  back to the postgres owner account unless explicitly instructed.
- Preserve the current Prisma/Supabase role strategy.
- Runtime reads `DATABASE_URL`; the Vercel/Supabase integration also provides
  `POSTGRES_*` names — keep `DATABASE_URL` set explicitly to the `resale_app` URL.

## Integrity Rules (never violate)

These are about honesty and safety, not scope — they stay no matter how big we get:

- Never fake successful marketplace publishing. A channel with no real adapter
  returns a typed NOT_IMPLEMENTED outcome; it does not pretend to succeed.
- Real publishing must actually call the marketplace API and reflect the true
  result. No simulated "live" states.
- Never invent prices with Gemini. Pricing comes only from real comp data; show
  "Needs comps" when there is none.
- Never fake or hand-fabricate comps as if they were real sales.
- Never publish or take destructive marketplace actions without explicit user intent.
- Never expose, log, or hardcode secrets/keys. Use environment variables.
- Never allow one user to access another user's data (scope every query to the seller).
- Never silently swallow failed validation or failed jobs — fail loudly and visibly.

## Deploy & Branch Safety (keep)

- `main` is production-safe and protected. Never push `main` without explicit approval.
- Merge flow: `feature/*` -> `develop` -> `main` -> production.
- No automatic deploys. Production deploys happen only when explicitly requested.
  Preview deploys are fine on request.
- Commit after the verification gate passes. Push only when asked.

## Engineering Rules

- Strict TypeScript; Zod at all external/AI boundaries; store raw + parsed AI output.
- Prisma for DB access; migrations are reviewed and routed through `develop`.
- Marketplace logic lives in adapters with explicit capability flags; UI branches
  on capabilities, never on a hardcoded marketplace id.
- Slow/unreliable work runs in idempotent background jobs.
- Pricing/business logic lives in pure, testable utilities; add tests for it.
- Prefer clear loading/empty/error states over decoration.
- Run the gate before finishing: `npm run lint`, `npm test`, `npx prisma validate`,
  `npm run build`.

## Current State

Shipped and verified (Phase 0 + Phase 1 live; T1–T7 on `develop`):

- Full app UI: dashboard, inventory (list/grid, sort, pagination, bulk
  delete/price/CSV), listing detail/editor (autosave, editable fields, photo
  add/remove/reorder/cover), publish history, marketplaces, new listing
  (photo -> Gemini), responsive layout, consistent states.
- Seller-scoped API: listings, listing detail, history, CSV import, item update,
  bulk price/delete, photos, comps + comps refresh.
- Honest publish flow (records real attempts; returns 501 NOT_IMPLEMENTED).
- Automatic comps pipeline (sources, dedupe/outlier, fetch job, refresh,
  auto-fetch on identify/load). Dormant until a comp source key is configured.
- Lifecycle actions (mark sold / delist).

Dormant/blocked on credentials or decisions (not on more code):

- Real comp data (needs eBay Browse prod / Marketplace Insights / StockX keys).
- Real eBay publishing (needs eBay production keyset + OAuth).
- Stripe monetization (needs Stripe keys).
- Always-on background worker host for queues.

## Next Up

1. Light up automatic pricing with a real comp source.
2. Real eBay publishing (production keyset + OAuth + Sell APIs), then expand to
   other channels behind capability-gated adapters.
3. Stripe subscriptions.
4. Background worker host + inventory sync.
