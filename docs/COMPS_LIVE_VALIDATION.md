# Apify eBay-sold provider — live validation

The Apify sold provider (`src/lib/comps/sources/apify-ebay-sold.ts`) is
implemented and unit-tested against a sanitized payload fixture
(`src/test/fixtures/apify-ebay-sold-sample.json`). It was also validated against
the live `caffein.dev/ebay-sold-listings` actor on 2026-06-17 with the harmless
query `Nike hoodie mens medium`, returning 30 sold comps with sanitized fields,
rawJson stored per comp, and no token in URLs/output.

Use this checklist when validating a new actor/account or staging environment.

## 1. Pick / create the actor
- On apify.com, choose an eBay **sold/completed** listings actor (or build one).
- Note its id/slug, e.g. `someuser~ebay-sold-scraper`.

## 2. Configure env (local or staging — never production yet)
```
APIFY_TOKEN="<your apify api token>"
APIFY_EBAY_SOLD_ACTOR="<actor id or slug>"
COMPS_APIFY_EBAY_SOLD_ENABLED="true"
COMPS_AUTO_DISCOVERY_ENABLED="true"
COMPS_REFRESH_COOLDOWN_SECONDS="60"
```
The token is sent only as an `Authorization: Bearer` header (never logged or put
in the URL). Do not commit it. If you only want one manual refresh, set
`COMPS_AUTO_DISCOVERY_ENABLED=true` temporarily in local/staging, run the
refresh, then turn it back off. With the master switch off, ordinary refresh
routes intentionally do not call providers.

## 3. One harmless validation call
- Open a real item in the editor, click **Refresh comps** (this calls the actor
  once for that item's query).
- The actor input we send is:
  `{ keywords: [keywords], searchTerms: [keywords], maxItems: 30, soldItems: true, ebayDomain: "ebay.com" }`.
  If the chosen actor expects a different input schema, adjust the actor's input
  defaults on Apify, or tell us the required shape and we'll map it.

## 4. Inspect the output shape (sanitized)
- In the Apify run's dataset, confirm each item exposes (any of) these — the
  mapper already handles all of them:
  - title: `title` / `name`
  - price: `soldPrice` / `price` (number, `"$1,234.56"`, or `{ value, currency }`)
  - shipping: `shippingPrice` / `shipping` / `shippingCost`
  - sold date: `soldDate` / `dateSold` / `endDate` / `endTime` / `endedAt`
  - url: `url` / `itemUrl` / `link`
  - image: `image` / `imageUrl` / `thumbnail` / `thumbnailUrl` / `galleryURL`
  - id: `id` / `itemId` / `epid`
  - condition: `condition`
- If a real field name is missing from the mapper, add it to
  `mapApifyEbaySoldItems` and extend the fixture + test with a **sanitized**
  sample (no tokens, no PII).

## 5. Confirm storage + pricing
- After the refresh, the editor's pricing panel should show sold comps, counts,
  and a recommendation. In the DB, `PriceComp` rows (`source = auto:apify-ebay-sold`)
  should exist with `rawJson` populated, and a `CompSearchRun` row should record
  the run (queries, sources, errors — no secrets).
- `rawJson` is bounded by the actor's `maxItems` (we cap mapping at 30 items).

## 6. Decide whether to keep auto discovery on
- Keep `COMPS_AUTO_DISCOVERY_ENABLED="true"` only when you want comps to run
  automatically after AI draft generation and when explicit Refresh comps should
  be available. Otherwise turn it back off after validation. Keep the refresh
  cooldown at 60s+.

## Cost / safety notes
- Each refresh = one actor run (Apify bills per run/compute unit). The cooldown
  prevents spam-clicking repeated runs. Provider failure is a no-op (`[]`) and
  never breaks draft generation or editor load.
- Kill switch: `COMPS_AUTO_DISCOVERY_ENABLED="false"` disables all auto comps;
  `COMPS_APIFY_EBAY_SOLD_ENABLED="false"` disables just this provider.
