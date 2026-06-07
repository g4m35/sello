# Comps Data Sources Plan

Status: planning only. No implementation in this document. No scraping. No
secrets. Pricing is never invented.

## Problem

`AutoPricing` already computes pricing from real `PriceComp` rows via
`calculatePricing` and shows an honest empty state when there is nothing to
price from. The missing piece is a system that **fetches real comps and writes
`PriceComp` rows** automatically, so sellers do not enter comps by hand.

## Principles

- Real comps only. Never invent prices. No fake comps.
- Official marketplace APIs first.
- Scraping is a last resort, off by default, and only where no official API
  exists.
- Secrets live in environment configuration, never committed.
- Idempotent background work, logged to `JobLog`.

## Architecture (mirror the marketplace adapter pattern)

The marketplace publishing layer (`src/lib/marketplace/adapter.ts`) already
establishes an adapter + registry + typed-capability pattern. Comps reuse it.

```
src/lib/comps/
  source.ts                 # CompSource interface + registry
  normalize.ts              # NormalizedComp -> PriceComp mapping, condition/currency/outlier rules
  match.ts                  # build a query key from an item (styleCode + size, or brand + title + size)
  sources/
    ebay-insights.ts        # official eBay sold comps (gated access)
    stockx.ts               # official StockX market data (partner access)
    thirdparty.ts           # aggregator API (interim, lower confidence)
src/lib/queues/comp-jobs.ts # BullMQ "comp-fetch" queue (alongside existing queues)
src/app/api/listings/comps/refresh/route.ts  # manual "refresh comps" trigger (seller-scoped)
```

### Interfaces (shape only, not implemented here)

- `CompSource`: `{ id, displayName, capabilities, fetchComps(query): Promise<NormalizedComp[]> }`.
  Capabilities describe whether a source returns **sold** data or only
  **active/asking** data, so the UI can label confidence honestly.
- `NormalizedComp`: `{ source, externalId, title, priceCents, shippingCents,
  soldDate, condition, url, matchScore }`.
- `match.ts`: derives a query from an `InventoryItem` (sneakers: `styleCode` +
  `size`; apparel: `brand` + normalized title + size) and a `matchScore` per
  returned comp.
- `normalize.ts`: maps a `NormalizedComp` to a `PriceComp` row, normalizes
  condition and currency, and applies recency and outlier rules before storage.

### Flow

1. After Gemini identification (in the existing draft create flow), enqueue a
   `comp-fetch` job keyed by the item's match query.
2. The job runs each enabled `CompSource`, normalizes results, dedupes by
   `(source, externalId)`, and writes `PriceComp` rows.
3. `calculatePricing` recomputes automatically; `AutoPricing` renders the
   result. If nothing matches, the honest empty state remains.
4. A seller-triggered `POST /api/listings/comps/refresh` re-runs the job on
   demand.

## Source landscape (ranked by legitimacy and effort)

| Source | Data | Access | Use |
|---|---|---|---|
| eBay Marketplace Insights API | True sold comps (~last 90 days) | Official, gated, requires application/approval | Primary general source once approved |
| eBay Browse API | Active listings only | Official, standard keys | Active-listing signal only. Must be labeled "active," never presented as sold |
| StockX API | Sneaker/streetwear last sale, bid/ask | Official partner program, requires approval | Primary sneaker source once approved, keyed by style code |
| Third-party sneaker aggregators | Sneaker market data | Quick keys, unofficial | Interim only, lower confidence, verify terms, expect breakage |
| GOAT / Grailed / Poshmark | Sold/active | No official API | Last resort only, scraping off by default, ToS-reviewed and rate-limited |

Notes:
- The legacy eBay Finding `findCompletedItems` endpoint is retired, so sold
  comps require Marketplace Insights access.
- eBay Browse returns asking prices, not sales. It can seed a low-confidence
  signal while sold-data access is pending, but it must never be stored or shown
  as a sold comp.

## Phased rollout

**Phase 0 - unblock long-lead items (do first, in parallel)**
- Apply for eBay Marketplace Insights API access and StockX API partner access.
  Approvals are the critical path for official data.
- Land the `CompSource` interface, `NormalizedComp` type, and the `comp-fetch`
  queue scaffold. No real keys, no source logic yet.

**Phase 1 - first real data (interim)**
- Implement one source behind the adapter: eBay Browse (clearly labeled active)
  and/or a third-party sneaker API (lower confidence).
- Wire the `comp-fetch` job into the post-identification flow. Write `PriceComp`
  rows; pricing recomputes automatically. Add source + recency labels in
  `AutoPricing`.

**Phase 2 - official sold data**
- Drop in eBay Marketplace Insights (sold) and StockX once approved. The adapter
  interface stays stable so this is a swap, not a rewrite.

**Phase 3 - matching and quality**
- Sneakers keyed on `styleCode` + `size`; apparel on `brand` + normalized title
  + size with a stored `matchScore`. Outlier trimming, recency window, currency
  normalization, condition mapping. Feeds the existing confidence scoring.

**Phase 4 - freshness and cost control**
- Redis cache per match key with TTL, on-demand and scheduled refresh, per-source
  rate limiting, observability through `JobLog` and the existing jobs panel.

**Phase 5 - last resort scrapers (only if needed)**
- Playwright sources for marketplaces without official APIs, gated behind explicit
  configuration, ToS review, conservative rate limits, and an honest user agent.
  Off by default.

## Cross-cutting

- Secrets: source API keys (`EBAY_*`, `STOCKX_*`, etc.) live in environment
  configuration (local `.env.local`, Vercel project env), never committed.
- Honesty: if no source returns matches, keep the current empty state. Never
  synthesize a price.
- Compliance: official APIs first; scraping gated and reviewed.

## Critical path / immediate next actions

1. Submit the eBay Marketplace Insights and StockX API access requests. They
   gate everything official.
2. Scaffold `CompSource` + the `comp-fetch` job (no keys) as the first reviewable
   step.
3. Integrate the first available source for an end-to-end demo while approvals
   pend.

## To confirm before building

Current access terms, quotas, and ToS for eBay Marketplace Insights and the
StockX API change over time and should be verified before committing to a source.

## Out of scope for this document

- No source implementation.
- No scraping.
- No secrets.
- No changes to the publishing stub (still 501 NOT_IMPLEMENTED).
