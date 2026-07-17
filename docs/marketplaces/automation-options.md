# Marketplace automation options

How far Sello can automate each marketplace, what is gated behind official APIs,
and the honest current state. This document is research and planning only. It
does not enable any live marketplace operation. No secrets or API keys live here.

Last research refresh: 2026-07-17 (primary developer-portal sources; see §11).

| Channel     | Today                             | Automation path                                                       |
| ----------- | --------------------------------- | --------------------------------------------------------------------- |
| eBay        | Live publish (gated)              | Official Sell APIs + OAuth, allowlisted alpha                          |
| StockX      | Native adapter (gated on creds)   | Official StockX API: catalog match, list, activate, deactivate, sync   |
| Etsy        | Copy-ready + gated API foundation | Official Etsy Open API v3 — live gated automation once creds + commercial access land |
| Depop       | Guided publish (copy-ready)       | **Official Depop Selling API is live (2026)** — partner-gated; apply via partnerships@depop.com; OAuth2 + sandbox; SKU-based product upsert, orders, offer webhooks. Target: gated native adapter (Phase B) |
| Vinted      | Guided publish (copy-ready)       | Official Vinted Pro Integrations API — allowlist + Pro/business sellers only; HMAC-signed requests (not OAuth); items/orders/webhooks. Apply, then build |
| Mercari     | Guided publish (copy-ready)       | No consumer-marketplace API (Mercari Shops API is a separate B2C product behind a business contract). Guided publish is the ceiling |
| Grailed     | Guided publish (copy-ready)       | No official listing API                                                |
| Poshmark    | Guided publish (copy-ready)       | No official public listing API                                         |
| TikTok Shop | Gated scaffold (no handler)       | TikTok Shop Open Platform: open registration, OAuth2, sandbox. Buildable without partner approval; deferred (off-vertical, GMV-Max ad mandate from 2026-07) |

"Guided publish" = structured field-level export, the marketplace's own sell-form
deep link, photo access, and mark-as-listed URL capture that enrolls the manual
listing in the double-sell safety engine. It is user-triggered on the seller's
own session; Sello never scripts the marketplace's site.

**Product rule:** every marketplace should reach the highest autonomy that an
official, compliant API allows. Etsy must not stay copy-ready-only: the Etsy Open
API v3 supports seller-authorized listing automation, so **Sello targets live Etsy
automation** (create draft → upload images → activate → deactivate → sync), gated
exactly like eBay. **Copy-ready is the Phase-1 fallback, not the final autonomy
level** — it remains available when the API is not connected/enabled.

Capability flags live in the adapter layer (`src/lib/marketplace/adapter.ts`); the
UI branches on capabilities, never on a hardcoded marketplace id. A channel with no
real publish adapter returns a typed `NOT_IMPLEMENTED` outcome and is never faked as
a success. Scraping a marketplace's own web forms is **not** a publish strategy for
any channel here, Etsy included. Etsy's runtime integration uses the **Etsy Open API
v3 directly**; the Etsy Dev MCP server is for documentation/research only and never
runs production behavior.

---

## Etsy

### 1. Official API / MCP availability

Etsy has a first-party, documented REST API: the **Etsy Open API v3** (90+ endpoints,
50+ data models). It supports creating, updating, and deleting listings, so a real
publish integration is technically possible — unlike Grailed/Poshmark, which have no
official public listing API.

Etsy also ships an official **Dev MCP Server**. It is a documentation/developer
assistant only: it answers questions about endpoints, schemas, and guides so an
assistant can help build an integration. It **does not call the Etsy API** and
performs **no shop or listing operations**. It is safe to use for research; it cannot
publish anything.

### 2. MCP config example (docs only — do not commit into app/runtime config)

```json
{
  "mcpServers": {
    "etsy": {
      "type": "http",
      "url": "https://mcp.api.etsycloud.com/mcp"
    }
  }
}
```

Tools exposed: `learn_etsy_api`, `search_etsy_api`, `list_endpoints`, `get_endpoint`,
`get_schema`, plus `list_guides` / `get_guide`. All read-only documentation lookups.

### 3. Listing create / update / delete feasibility

Feasible via the Open API v3 (each requires an OAuth token with the right scope):

- **Create** — `createDraftListing` (`POST /v3/application/shops/{shop_id}/listings`)
  creates a *draft* listing (not public until published). Requires `listings_w`.
- **Images** — `uploadListingImage` attaches photos to a listing. Requires `listings_w`.
- **Update** — `updateListing` / `updateListingInventory` edit fields, price, and
  quantity. Requires `listings_w`.
- **Delete** — `deleteListing` (`DELETE /v3/application/listings/{listing_id}`).
  Requires `listings_d`.
- **Read** — `getListingsByShop`, `getListing`. Requires `listings_r` (some reads are
  public with just the API key).

A safe rollout would create **drafts** first (seller reviews and publishes in Etsy),
before ever calling a publish/activate step automatically.

### 4. OAuth / scopes needed

Etsy uses two credentials together:

- **API key** (`x-api-key` header) on **every** request.
- **OAuth 2.0 token** for any private or write endpoint. **PKCE is mandatory** on
  every authorization flow.

Scopes Sello would request (space-separated), least-privilege first:

- `listings_r` — read shop listings
- `listings_w` — create/update listings and upload images
- `listings_d` — delete listings (only if Sello manages delists)
- `transactions_r` — read receipts/orders (for inventory sync / mark-sold)
- `shops_r` — read shop config (shipping profiles, sections, policies)

Access levels:

- **Personal access** (default): the app's owner connects up to **5 shops**. Fine for
  a sandbox/dev rehearsal and early dogfooding.
- **Commercial access**: required for a general-purpose app that lists on **other
  sellers'** shops. Must be requested and approved by Etsy ("Request Commercial
  Access"). This is the real gate before alpha sellers can connect their own shops.
- **Dormancy**: an app with no successful request in 6 months is banned — keep a
  health check once integration is live.

### 5. Shop / listing / order API possibilities

- **Shop**: `getShop`, shop sections, shipping profiles, return policies.
- **Taxonomy**: `getSellerTaxonomyNodes` and property endpoints (public, API key only)
  map an item to an Etsy category (`taxonomy_id`) and its required/optional properties.
- **Listings**: full CRUD as above, plus inventory (variations, quantity, price).
- **Orders**: `getShopReceipts` for sold orders → feeds inventory sync / mark-sold,
  the same pattern eBay uses.

### 6. What Sello can automate safely

- Generate a complete **copy-ready Etsy draft** from the master listing (shipped now):
  title, description, keyword tags, price, quantity, condition, suggested category,
  materials/style notes, a photo checklist, and an explicit "Needs seller review"
  block for Etsy-specific required fields. This is local text generation; it touches
  no Etsy systems.
- Later, behind official-API auth: **create Etsy draft listings** and **upload photos**
  for the seller to review and publish, and **read receipts** for inventory sync.

### 7. What requires seller approval / human review

- **Listing type**: who made it, what it is, and when it was made (handmade, vintage
  20+ years, or a craft supply). Most resale streetwear/sneakers are **none** of these,
  so Etsy eligibility is a seller decision Sello must not assert.
- **Shipping profile** (processing time + rates), **return & exchange policy**, and the
  final **shop section / category** — seller-owned config Sello cannot invent.
- The actual **publish/activate** step — always explicit seller intent, never automatic.

Sello surfaces all of the above as "Needs seller review" rather than implying the draft
is publish-ready.

### 8. Risks / gaps

- **Category / taxonomy mapping**: Etsy's taxonomy differs from eBay's. Required
  properties vary per `taxonomy_id`; mapping resale categories needs a real mapping
  layer (and a fallback to "confirm category").
- **Shipping profiles**: a listing needs a valid `shipping_profile_id`. Sello does not
  own the seller's shipping config; it must be selected/created by the seller.
- **Listing policies**: return policy, renewal (auto vs manual), and shop sections are
  shop-level settings outside Sello's data model.
- **Handmade / vintage / resale fit**: Etsy's core inventory policy targets handmade,
  vintage (20+ years), and craft supplies. General resale can violate policy. This is
  the biggest product risk and must stay a seller decision.
- **API approval / rate limits**: commercial access requires Etsy approval before
  third-party sellers can connect. Rate limits are application-level QPD + QPS (sliding
  window; HTTP 429 + `retry-after` when exceeded). Plan caching and exponential backoff.

### 9. Recommended rollout

- **Phase 1 — Copy-ready Etsy drafts (shipped).** Local draft generation + export,
  honest "Needs seller review", no Etsy systems touched. Stays as the fallback.
- **Phase 2 — Gated API integration foundation (this PR).** Etsy adapter with
  capability flags, fail-closed env config + per-seller allowlists, PKCE OAuth
  connect/callback/disconnect with encrypted token storage, an Etsy Open API v3 client
  wrapper with sanitized error mapping, and gated readiness/publish/delist/sync route
  handlers. Everything fails closed when credentials/gates/connection are missing; no
  live Etsy calls happen without real env credentials, which are not in the repo.
- **Phase 3 — Dev/personal validation.** Under personal access (≤5 shops), with real
  env credentials set in the deployment (never the repo), create **draft** listings +
  upload images against the owner's own shop behind the allowlist, and read receipts to
  validate sync. Still seller-confirmed; drafts-first.
- **Phase 4 — Live publish for sellers.** Only after explicit owner approval, Etsy
  **commercial access** approval, and the same gates eBay uses (readiness, audited
  attempts, allowlist, global switch). Drafts-first; never auto-activate.

### 10. Required to enable Etsy live (summary)

A real Etsy app (API key + secret), the env credentials below set in the deployment
(not the repo), PKCE OAuth, the minimal scopes, a taxonomy/category mapping, the
seller's shipping profile + return policy + shop section selection, and Etsy
**commercial access** approval before non-owner sellers can connect.

Runtime env (names only — never commit values):
`ETSY_API_ENABLED`, `ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET` (if the app type requires
it), `ETSY_REDIRECT_URI`, `ETSY_API_BASE_URL`, `ETSY_SCOPES`,
`ETSY_TOKEN_ENCRYPTION_KEY`, `ETSY_OAUTH_STATE_SECRET`, and the per-seller allowlists
`ETSY_CONNECT_EMAILS`, `ETSY_PUBLISH_EMAILS`, `ETSY_DELIST_EMAILS`,
`ETSY_ORDERS_EMAILS`.

---

## eBay (reference)

eBay is the live-capable channel: official Sell APIs (Inventory + Fulfillment),
OAuth, business policies, and an enabled inventory location. Production publish stays
gated behind an allowlist and a global switch, with every attempt audited. Etsy's
Phase 4 should reuse these gates rather than inventing new ones. See
`docs/FIRST_LIVE_PUBLISH.md` and `docs/ALPHA_LIVE_ACTIONS.md`.

## Grailed / Poshmark / Mercari (reference)

- **Grailed / Poshmark / Mercari**: no official public listing API today — guided
  publish (structured copy-ready export + sell-form deep link + mark-as-listed) is
  the ceiling unless that changes. Third-party crosslisters go further with
  browser-extension form fill on the seller's own session; Sello has deliberately
  not shipped that (unverifiable DOM automation, ToS exposure). Revisit only with
  owner sign-off.

## Depop (2026-07 update)

Depop's official **Selling API** (partner API) is live: OAuth2, sandbox with
purchase simulation, SKU-based create/update/delete, order retrieval, offer
automation, and order webhooks. Access is private: apply by emailing
partnerships@depop.com. Scopes observed in the reference: `products_read`,
`products_write`, `orders_read`, `orders_write`, `offers_read`, `offers_write`,
`shop_read`. Plan: mirror the Etsy Phase 2 gated foundation
(`feature/depop-api-foundation`), fail-closed env config
(`DEPOP_API_ENABLED` + credential names, per-seller allowlists), drafts-first,
then light up per-seller once partnership approval lands.

## 11. Research sources (2026-07-17)

- Depop Selling API: https://partnerapi.depop.com/api-docs/ (overview: private,
  partner application; sandbox), https://partnerapi.depop.com/api-docs/reference/
- Vinted Pro Integrations: https://pro-docs.svc.vinted.com/ (items, orders,
  webhooks; HMAC access keys via the pro portal)
- Mercari Shops API (business-contract B2C product, not the consumer marketplace):
  https://api.mercari-shops.com/docs/index.html
- TikTok Shop Open Platform: https://partner.tiktokshop.com/docv2/page/tts-developer-guide
- Whatnot Seller API (closed to new applicants): https://developers.whatnot.com/
- Bonanza (open, low reach): https://api.bonanza.com/docs ; Reverb (open, music
  vertical): https://www.reverb-api.com/ ; eBid (open, negligible reach):
  https://ebid.3scale.net/
- Vestiaire Collective Seller API (approval + volume gated; primary docs are a JS
  SPA, details partly from connector guides — treat as unverified):
  https://seller-api-docs.vestiairecollective.com/
