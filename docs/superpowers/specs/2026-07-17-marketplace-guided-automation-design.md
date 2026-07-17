# Marketplace guided automation — design

Date: 2026-07-17. Author: Claude (Fable), autonomous session authorized by the owner
("research… then implement… fully complete this verify and test everything… if more
automation can be achieved… then do it"). The owner was away, so approval gates in this
design were resolved by documented decision instead of live dialogue.

## Goal

Push every marketplace flow to the highest automation level that is real, honest, and
testable today, and fix flow defects found along the way. Research inputs:

1. Codebase flow map (2026-07-17): only eBay/StockX/Etsy have live handlers. The
   assisted channels' entire automation is a single clipboard blob. The manual
   "add a marketplace URL" route (`POST /api/inventory/listings`) — which is what lets
   the double-sell safety engine cover manual channels — has **no UI consumer and no
   API-client function**. Registry inconsistencies: `vinted` and `stockx` declare
   `fallbackMode: "assisted_export"` with no formatter behind it; `tiktok_shop` claims
   `full_native` (and is therefore publish-queue-eligible) with no handler.
2. Market research (2026-07-17, primary sources): **Depop's official Selling API is
   live** (partner-gated via partnerships@depop.com, OAuth2, sandbox, SKU-based
   upsert, order webhooks) — docs at partnerapi.depop.com/api-docs. Grailed, Poshmark,
   and Mercari have **no official API** (industry automates them with user-triggered
   browser form-fill). Vinted has an official Pro Integrations API (allowlist +
   business sellers, HMAC auth). TikTok Shop is open-registration but off-vertical.
   Mercari is a top-5 US general resale channel and is absent from Sello entirely.

## Approaches considered

1. **Guided publish + close the safety loop + Depop API foundation (chosen).**
   Upgrade assisted channels from "copy one blob" to a guided flow (field-level copy,
   open-the-sell-form deep link, photo access, integrated "mark as listed" URL
   capture), add Mercari as an assisted channel, fix the registry honesty gaps, and
   build the Depop official-API adapter foundation on the proven Etsy pattern
   (fail-closed, no live calls without credentials). Everything is testable today
   without partner approval; Depop lights up when the owner's partnership application
   is approved.
2. **Browser-extension form-fill engine (Vendoo-style).** Highest theoretical
   automation for no-API channels and within the owner's stated bot-risk tolerance,
   but it is a new MV3 artifact whose per-marketplace DOM selectors cannot be
   verified without logged-in marketplace accounts, and it would ship as untested
   guesswork — which violates the repo rule against unverifiable behavior. Deferred;
   the structured field export introduced here is exactly the payload a future
   extension would consume.
3. **TikTok Shop full native build.** Open registration and sandbox exist, but it
   requires the owner to register a Partner Center app first, the product/logistics
   API surface is large, and the channel skews new-goods rather than resale. Deferred.

## Design (chosen approach)

### A. Guided publish for assisted channels

Channels: `grailed`, `poshmark`, `depop` (until its API is approved), `vinted`,
and new `mercari`.

- **Structured export.** `buildListingExport` gains a `fields` array —
  `{ key, label, value }` entries (title, description, price, brand, size, condition,
  color, style code, tags/hashtags, category suggestion) — alongside the existing
  `{title, body, warnings}` so current consumers/tests keep working. The export route
  returns it. Field values reuse the existing resolve logic; empty fields are omitted
  rather than faked (matches export-formatter conventions).
- **New formatters.** `vinted` and `mercari` join `ExportMarketplaceSchema` with
  formatters matching each site's conventions (Vinted: title 255, plain description,
  no hashtag spam; Mercari: 80-char title, hashtags allowed up to 3, brand/condition
  fields called out). `stockx` keeps no text formatter; its registry `fallbackMode`
  becomes `null` (catalog-driven listing has no meaningful paste text) — honest
  instead of aspirational.
- **Sell-form deep links.** A per-marketplace `sellFormUrl` in a new
  `src/lib/marketplace/guided-listing.ts` (grailed.com/sell/new,
  poshmark.com/create-listing, depop.com/products/create, vinted.com/items/new,
  mercari.com/sell). Verified for liveness during implementation. Rendered as
  "Open <marketplace> sell form" external links — the seller's own session, no bot.
- **Guided listing panel.** The inventory item page's copy-export card becomes a
  guided panel: field rows each with a copy button, the deep link, the item's photos
  (open/download links — no zip dependency), and a **"Mark as listed"** input where
  the seller pastes the live listing URL.
- **Close the loop.** "Mark as listed" wires the existing orphan route
  `POST /api/inventory/listings` into the API client + UI (client-side URL host
  validation per marketplace, server stays authoritative). Once recorded, the
  existing mark-sold engine (`queueDelistOtherListings`) covers the manual channel:
  when the item sells elsewhere, the worker opens a manual review task/notification
  to delist it. This turns the safety engine's manual-channel support from dead code
  into a working flow.

### B. Depop official-API adapter foundation (Etsy pattern, fail-closed)

Mirror `src/lib/marketplace/adapters/etsy/` for Depop: config (env-gated,
fail-closed, `DEPOP_API_ENABLED` + credential names only), OAuth2
connect/callback/disconnect with encrypted token storage (AES-256-GCM, same
token-crypto approach), client wrapper for the Selling API (SKU-based product
upsert, sanitized error mapping, 401/403/429/5xx handling), capabilities gated by
per-seller allowlists (`DEPOP_CONNECT_EMAILS`, `DEPOP_PUBLISH_EMAILS`,
`DEPOP_DELIST_EMAILS`, `DEPOP_ORDERS_EMAILS`), readiness, publish (draft-first),
delist, status sync, and routes under `src/app/api/marketplaces/depop/`. Registry
entry moves `depop` from `assisted` to `full_native` with `fallbackMode:
"copy_ready"` **only when** the adapter ships; guided publish remains the fallback.
No live Depop call is possible without env credentials, which do not exist in the
repo. Deliverable for the owner: a ready-to-send partnership application email.

Sequencing: B ships as its own branch/PR after A+C is green, so a review can take
A+C even if B needs iteration.

### C. Consistency and honesty fixes

- `tiktok_shop` registry `integrationMode` → `gated_scaffold` until a real handler
  exists (also makes it publish-queue-ineligible — correct fail-closed behavior).
- `vinted` fallback becomes real via its new formatter; `stockx` fallback → `null`.
- Add `mercari` everywhere a marketplace lives: Prisma enum (additive migration,
  same pattern as `20260623000000_add_etsy_marketplace`), app `MarketplaceSchema`,
  adapter stub, registry (assisted, copy_ready), display name, email-parser domains
  (mercari.com), feedback + defaults conventions, export schema/formatter.
- Any defects found during verification get fixed on the A+C branch.

### Error handling

No new error surfaces: export stays read-only; "Mark as listed" reuses the route's
existing validation and safe error responses; guided panel shows the same sanitized
errors the copy flow shows today. Fail-closed rules untouched.

### Testing

TDD per change: formatter unit tests (vinted/mercari/fields), export-route tests,
migration test for the enum, registry tests (queue eligibility flip), API-client +
panel tests for mark-as-listed, email-parser mercari tests. Full gate
(`prisma validate`, lint, `typecheck`, `npm test`, build) plus authenticated
`scripts/e2e-smoke.mts` against a local dev server and browser QA of the guided
panel. Depop foundation gets the same unit/route coverage as Etsy's (client with
injected fetch, config fail-closed tests, route 401/403/503 tests).

## Decisions made in the owner's absence

1. Extension-based form fill deferred (untestable without marketplace logins) — the
   structured payload ships now so an extension can consume it later.
2. Mercari added as a new enum value via additive migration; migration is committed
   but **not applied to prod by this session** (repo rule: owner applies via
   `npm run db:deploy`). All new code paths tolerate the value being absent from the
   DB until then (enum value only matters once a seller selects/records it).
3. StockX assisted-export fallback removed (registry honesty) rather than invented.
4. No landing-page copy changes (freshly redesigned and deployed); over-claims there
   are listed in the final report for the owner to judge.
5. No deploy, no push to main, no live marketplace calls, no prod migration — all
   remain owner-authorized operations. Feature branches + PRs into develop are the
   terminal state of this session.
