# Automatic Price Comps — Providers & Rollout

How Sello fetches real pricing comps. Everything here is **off by default** and
safe to disable. No comps are ever invented; a provider with no data returns `[]`.

## Pipeline

1. AI draft completes → the draft POST runs `runCompFetch` once for the item
   (one-shot; never on a passive GET/detail/editor load).
2. Enabled providers are queried with generated query variants.
3. Results are normalized → deduped → match-scored → outlier-trimmed → stored as
   `PriceComp` rows (`auto:<source>`), replacing prior auto comps (manual comps
   are untouched).
4. `summarizeComps` produces low / median / average / high, quick-sale,
   recommended list, confidence score + reasons, and sold/active counts.
5. A `CompSearchRun` row records the run (queries, sources checked, errors).
6. "Refresh comps" re-runs the same flow on demand (rate-limited).

## Global kill switch

```
COMPS_AUTO_DISCOVERY_ENABLED="false"   # master switch; when off, NO auto comps run
                                       # (legacy alias: PRICE_COMP_AUTO_DISCOVERY_ENABLED)
```

A provider runs only when the master switch **and** that provider's flag **and**
its credentials are all present.

## Providers (priority order)

### 1. eBay sold (Apify) — primary sold comps
```
COMPS_APIFY_EBAY_SOLD_ENABLED="false"  # (legacy alias: PRICE_COMP_APIFY_EBAY_SOLD_ENABLED)
APIFY_TOKEN="[APIFY_API_TOKEN]"        # sent as a Bearer header, never logged
APIFY_EBAY_SOLD_ACTOR="[apify_actor_id_or_slug]"  # e.g. "user~ebay-sold-scraper"; required to run
```
Calls the actor's `run-sync-get-dataset-items` endpoint and maps sold listings.
Failure-safe: any error / non-2xx / unparseable payload → `[]`. Raw provider
payload is stored in `PriceComp.rawJson`.
**Cost/rate:** Apify bills per actor run / compute unit; each refresh = one run.
Keep the refresh cooldown on (below) and set a sane `maxItems` in the actor.

### 2. eBay active (Browse API) — active market context
```
COMPS_EBAY_ACTIVE_ENABLED="false"      # (legacy alias: PRICE_COMP_EBAY_SEARCH_ENABLED)
EBAY_BROWSE_CLIENT_ID="[OR_USE_EBAY_CLIENT_ID]"
EBAY_BROWSE_CLIENT_SECRET="[OR_USE_EBAY_CLIENT_SECRET]"
EBAY_BROWSE_MARKETPLACE_ID="EBAY_US"
```
Active asking prices (not sold). Used as ceiling/context; confidence is capped at
medium when pricing rests on active listings only.
**Cost/rate:** eBay Browse has generous app-token rate limits; calls are cheap.

### 3. eBay active (SerpApi) — optional fallback (dormant stub)
```
COMPS_SERPAPI_EBAY_ACTIVE_ENABLED="false"
SERPAPI_API_KEY="[SERPAPI_API_KEY]"
```
Not implemented yet (returns `[]`); leave disabled. Only a backup to eBay Browse.

## Refresh cooldown

```
COMPS_REFRESH_COOLDOWN_SECONDS="60"    # default 60; set "0" to disable
```
The manual "Refresh comps" POST returns `429` (with `Retry-After`) inside the
window so spam-clicking cannot fire repeated paid provider calls. The one-shot
auto run after draft generation is not throttled.

## `.env.example` additions (apply manually)

Add under the existing price-comp block (the legacy `PRICE_COMP_*` names still
work; these are the canonical names):

```
COMPS_AUTO_DISCOVERY_ENABLED="false"
COMPS_EBAY_ACTIVE_ENABLED="false"
COMPS_APIFY_EBAY_SOLD_ENABLED="false"
APIFY_TOKEN="[APIFY_API_TOKEN]"
APIFY_EBAY_SOLD_ACTOR="[apify_actor_id_or_slug]"
COMPS_SERPAPI_EBAY_ACTIVE_ENABLED="false"
SERPAPI_API_KEY="[OPTIONAL_SERPAPI_API_KEY]"
COMPS_REFRESH_COOLDOWN_SECONDS="60"
```

## Production rollout checklist

1. Apply the DB migrations (none new in this change beyond existing PriceComp v2 /
   CompSearchRun — see `prisma migrate status`).
2. Configure the Apify actor; set `APIFY_TOKEN` + `APIFY_EBAY_SOLD_ACTOR`.
3. Turn on **one** provider at a time:
   - `COMPS_EBAY_ACTIVE_ENABLED="true"` (cheap; validate active context first), then
   - `COMPS_APIFY_EBAY_SOLD_ENABLED="true"` (validate sold mapping + cost).
4. Set `COMPS_AUTO_DISCOVERY_ENABLED="true"` last to enable the auto run.
5. Verify on a real item: draft → comps populate → confidence/reasons look sane.
6. Keep `COMPS_REFRESH_COOLDOWN_SECONDS` at 60+ in production.

## Kill switch / disable

- Disable everything instantly: `COMPS_AUTO_DISCOVERY_ENABLED="false"`.
- Disable one provider: set its `COMPS_*_ENABLED="false"` (or remove its token).
- Existing manual comps and stored pricing are unaffected by disabling providers.
