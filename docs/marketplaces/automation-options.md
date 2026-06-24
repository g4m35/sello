# Marketplace automation options

How far Sello can automate each marketplace, what is gated behind official APIs,
and the honest current state. This document is research and planning only. It
does not enable any live marketplace operation. No secrets or API keys live here.

| Channel  | Today                    | Automation path                              |
| -------- | ------------------------ | -------------------------------------------- |
| eBay     | Live publish (gated)     | Official Sell APIs + OAuth, allowlisted alpha |
| Grailed  | Copy-ready draft         | No official listing API                       |
| Poshmark | Copy-ready draft         | No official public listing API                |
| Depop    | Copy-ready draft         | Official private API request in progress      |
| Etsy     | Copy-ready draft         | Official Etsy Open API v3 (research → phased)  |

Capability flags live in the adapter layer (`src/lib/marketplace/adapter.ts`); the
UI branches on capabilities, never on a hardcoded marketplace id. A channel with no
real publish adapter returns a typed `NOT_IMPLEMENTED` outcome and is never faked as
a success. Scraping a marketplace's own web forms is **not** a publish strategy for
any channel here, Etsy included.

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
  honest "Needs seller review", no Etsy systems touched.
- **Phase 2 — Official API auth research.** Register the app, design PKCE OAuth +
  `x-api-key`, request the minimal scopes, and prototype taxonomy mapping. Use the Dev
  MCP Server for spec lookups. No live writes.
- **Phase 3 — Sandbox / dev integration.** Under personal access (≤5 shops), create
  **draft** listings + upload images against the owner's own shop, behind a feature
  flag. Read receipts to validate inventory sync. Still seller-published.
- **Phase 4 — Live publish.** Only after explicit owner approval, Etsy **commercial
  access** approval, and the same test gates eBay uses (readiness, audited attempts, an
  allowlist, and a global switch). Drafts-first; never auto-activate.

---

## eBay (reference)

eBay is the live-capable channel: official Sell APIs (Inventory + Fulfillment),
OAuth, business policies, and an enabled inventory location. Production publish stays
gated behind an allowlist and a global switch, with every attempt audited. Etsy's
Phase 4 should reuse these gates rather than inventing new ones. See
`docs/FIRST_LIVE_PUBLISH.md` and `docs/ALPHA_LIVE_ACTIONS.md`.

## Grailed / Poshmark / Depop (reference)

- **Grailed / Poshmark**: no official public listing API today — copy-ready drafts are
  the ceiling unless that changes.
- **Depop**: copy-ready today; an official private API request is in progress. If
  access is granted, it follows the same drafts-first, gated path as Etsy Phase 3–4.
