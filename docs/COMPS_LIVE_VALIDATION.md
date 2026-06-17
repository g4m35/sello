# Apify eBay-sold provider — live validation (owner steps)

The Apify sold provider (`src/lib/comps/sources/apify-ebay-sold.ts`) is
implemented and unit-tested against a sanitized payload fixture
(`src/test/fixtures/apify-ebay-sold-sample.json`), **but it has NOT been run
against a live Apify actor** — the build/session environment has no `APIFY_TOKEN`
or `APIFY_EBAY_SOLD_ACTOR`, and we do not fake live validation. Follow these steps
once in a local/staging environment to confirm the real actor output shape.

## 1. Pick / create the actor
- On apify.com, choose an eBay **sold/completed** listings actor (or build one).
- Note its id/slug, e.g. `someuser~ebay-sold-scraper`.

## 2. Configure env (local or staging — never production yet)
```
APIFY_TOKEN="<your apify api token>"
APIFY_EBAY_SOLD_ACTOR="<actor id or slug>"
COMPS_APIFY_EBAY_SOLD_ENABLED="true"
# leave COMPS_AUTO_DISCOVERY_ENABLED unset/false for now
COMPS_REFRESH_COOLDOWN_SECONDS="60"
```
The token is sent only as an `Authorization: Bearer` header (never logged or put
in the URL). Do not commit it.

## 3. One harmless validation call
- Open a real item in the editor, click **Refresh comps** (this calls the actor
  once for that item's query — auto-discovery stays off, so nothing else runs).
- The actor input we send is:
  `{ keywords, searchTerms: [keywords], maxItems: 30, soldItems: true, ebayDomain: "ebay.com" }`.
  If the chosen actor expects a different input schema, adjust the actor's input
  defaults on Apify, or tell us the required shape and we'll map it.

## 4. Inspect the output shape (sanitized)
- In the Apify run's dataset, confirm each item exposes (any of) these — the
  mapper already handles all of them:
  - title: `title` / `name`
  - price: `soldPrice` / `price` (number, `"$1,234.56"`, or `{ value, currency }`)
  - shipping: `shippingPrice` / `shipping` / `shippingCost`
  - sold date: `soldDate` / `dateSold` / `endDate` / `endTime`
  - url: `url` / `itemUrl` / `link`
  - image: `image` / `imageUrl` / `thumbnail` / `galleryURL`
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

## 6. Only then enable auto discovery
- Set `COMPS_AUTO_DISCOVERY_ENABLED="true"` so comps run automatically after AI
  draft generation. Keep the refresh cooldown at 60s+.

## Cost / safety notes
- Each refresh = one actor run (Apify bills per run/compute unit). The cooldown
  prevents spam-clicking repeated runs. Provider failure is a no-op (`[]`) and
  never breaks draft generation or editor load.
- Kill switch: `COMPS_AUTO_DISCOVERY_ENABLED="false"` disables all auto comps;
  `COMPS_APIFY_EBAY_SOLD_ENABLED="false"` disables just this provider.
