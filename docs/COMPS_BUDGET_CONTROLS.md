# Paid comp-provider budget & quota controls

Hard, server-side cost controls for paid comp providers (Apify eBay-sold). Every
paid call is gated and ledgered before it runs, so auto-discovery cannot create
uncontrolled cost. Free sources (eBay Browse active) and manual comps are never
affected by these gates.

## Gate order (server-side, before any paid call)

1. **`paid_providers_disabled`** — the emergency kill switch
   `COMPS_PAID_PROVIDERS_ENABLED` is not `true`. (Absolute; overrides admin override.)
2. **admin override** — if `COMPS_ADMIN_OVERRIDE_ENABLED=true`, budget/quota/cooldown
   are bypassed (the kill switch still applies).
3. **`global_budget_exceeded`** — today's summed estimated cost + this call's
   estimate would exceed `COMPS_APIFY_DAILY_BUDGET_CENTS`.
4. **`user_daily_quota_exceeded`** — user's paid calls today ≥ `COMPS_USER_DAILY_PROVIDER_CALL_LIMIT`.
5. **`user_monthly_quota_exceeded`** — user's paid calls this month ≥ `COMPS_USER_MONTHLY_PROVIDER_CALL_LIMIT`.
6. **`draft_cooldown_active`** — a paid call ran for this draft within
   `COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS`.

Other ledgered skip/failure reasons: `weak_identity` (generic items, before any
paid call), `provider_not_configured`, `provider_error` (the call threw / non-2xx).

## Ledger

Every paid call attempt is written to `ProviderCallLedger` (one row): `userId`,
`draftId`, `inventoryItemId`, `provider`, `status` (attempted/succeeded/failed/
skipped), `skippedReason`, `estimatedCostCents`, `fetchedCount`, `acceptedCount`,
`rejectedCount`, `queryHash`, `createdAt`. Only attempted/succeeded/failed rows
count toward budget/quota; skipped rows are free. Rows are **seller-scoped** (RLS
enabled) and never store tokens or raw error text. The seller-scoped log is at
`GET /api/listings/comps/provider-usage` (recent rows + today/month totals).

## Env vars (add to `.env.example` / environment)

```
# Paid comp-provider budget & quota controls (Apify). All OFF/safe by default.
COMPS_PAID_PROVIDERS_ENABLED="false"          # emergency kill switch for ALL paid providers
COMPS_ADMIN_OVERRIDE_ENABLED="false"          # bypass budget/quota (NOT the kill switch)
COMPS_APIFY_DAILY_BUDGET_CENTS="500"          # global daily spend cap (cents)
COMPS_APIFY_ESTIMATED_COST_CENTS="35"         # estimated cost charged per paid call
COMPS_USER_DAILY_PROVIDER_CALL_LIMIT="25"     # per-user paid calls per day
COMPS_USER_MONTHLY_PROVIDER_CALL_LIMIT="300"  # per-user paid calls per month
COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS="600"   # min seconds between paid calls per draft
```

> NOTE: `.env.example` could not be edited in-sandbox (`.env*` is guarded). Paste
> the block above into `.env.example` and the deployed environment manually.

## QA steps (local/staging)

1. With `COMPS_PAID_PROVIDERS_ENABLED` unset: Refresh comps on a branded item →
   Apify is NOT called; a `skipped/paid_providers_disabled` ledger row is written;
   manual comps and any free source still work.
2. Set `COMPS_PAID_PROVIDERS_ENABLED=true` + configure Apify (see
   `COMPS_LIVE_VALIDATION.md`): Refresh → one `succeeded` ledger row with
   `estimatedCostCents`/`fetchedCount`; pricing updates.
3. Set `COMPS_APIFY_DAILY_BUDGET_CENTS` below today's spend → next Refresh writes
   `skipped/global_budget_exceeded` and does NOT call Apify.
4. Set `COMPS_USER_DAILY_PROVIDER_CALL_LIMIT=1`, refresh twice → second is
   `skipped/user_daily_quota_exceeded`.
5. Refresh the same draft twice quickly → second is `skipped/draft_cooldown_active`.
6. Confirm `GET /api/listings/comps/provider-usage` returns only the current
   seller's rows + today/month totals.

## Rollout

- Ship with `COMPS_PAID_PROVIDERS_ENABLED=false` (paid off) and verify the skip
  path in production logs/ledger.
- Set conservative caps first (e.g. budget `$3-5/day`, user daily `5-10`), then
  flip `COMPS_PAID_PROVIDERS_ENABLED=true`.
- Watch `ProviderCallLedger` daily spend; raise caps only after observing real cost.
- **Kill switch:** set `COMPS_PAID_PROVIDERS_ENABLED=false` to stop all paid calls
  immediately (no deploy needed if env is hot-reloaded).
