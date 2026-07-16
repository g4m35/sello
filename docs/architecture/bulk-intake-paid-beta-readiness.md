# Bulk intake and paid-beta readiness architecture

This document is authoritative for the production-readiness changes introduced by the `paid-beta-p0-readiness` task. Code, migrations, tests, and `docs/architecture/invariants.md` remain the final authority.

## Delivery-state vocabulary

| State | Meaning for this change |
| --- | --- |
| Implemented | Code, schema, migration, and tests exist on the task branch. |
| Validated locally | The recorded local commands passed without a live provider or marketplace call. |
| Migration prepared | Forward migration SQL exists and passed static migration tests and Prisma validation. |
| Migration applied | A named target's `_prisma_migrations` ledger contains the verified checksum. |
| Deployed | The application commit is active in a named environment. |
| Smoke-tested | The dedicated test-account runbook passed in that environment. |
| Production verified | Metrics and audit evidence show the deployed behavior is healthy. |

This task may claim only the first three states. It does not apply migrations, deploy, smoke-test production, or claim production verification.

## Bulk-intake lifecycle

Bulk intake creates editable canonical inventory and listing records. It never publishes or delists a marketplace listing.

Exact batch statuses:

```text
created uploading processing needs_review ready partially_failed failed canceled
```

Exact item statuses:

```text
uploaded grouping ready_for_generation generating needs_review listing_ready failed canceled
```

Photos remain deterministically ordered by `(batchId, position)` and, once grouped, by `(batchId, bulkItemId, itemPosition)`. Every photo belongs to exactly one batch; grouping requires every uploaded photo exactly once. Regrouping is rejected after generation or canonical inventory creation begins.

`BulkItem.accountId` and `BulkPhoto.accountId` are derived from `BulkBatch.accountId`. Composite foreign keys prevent batch/account drift and inventory links across accounts. A database trigger rejects a photo-to-item link when the item is not in the same batch/account. Compatibility triggers populate child account IDs for the pre-migration application during migration-first rollout and application rollback.

Conversion is exactly-once through the unique `BulkItem.inventoryItemId` link and a conditional item claim. Inventory, photos, listing, AI evidence, and the bulk link are written in one transaction. Canceling a batch changes only unfinished bulk items; already-created inventory and listing records survive.

Starting or resuming a batch also recovers account-scoped item generations that have remained `generating` for 15 minutes without a canonical inventory link. Recovery conditionally moves the stale attempt to `failed`, expires its matching usage reservation, and makes the item explicitly retryable; a late conversion cannot commit because its `generating` claim no longer matches.

## Atomic usage reservations

`UsageReservation` is the durable authority for `ai_listing`, `autopublish`, and `comp_refresh` work.

1. Resolve the active subscription period and current account plan inside a transaction.
2. Acquire a transaction-scoped advisory lock for account, metric, and period.
3. Return an existing reservation for a repeated `(accountId, metric, idempotencyKey)`.
4. Compare current reserved/settled usage plus requested units with the current plan limit.
5. Persist either `denied` with `USAGE_LIMIT_EXCEEDED`, or `reserved` and increment `UsageCounter` in the same transaction.
6. `settled` leaves the counter unchanged because capacity was consumed at reservation time.
7. `released` or `expired` decrements the same period counter under the same advisory lock.

Members share one account limit. A reservation snapshots plan and limit, so a valid in-flight operation can settle after a downgrade; subsequent reservations use the new plan and fail closed if the account is already above it. Admin override uses the same durable records and counter, with the bounded admin limit; it does not bypass provider or marketplace kill switches.

Paid-provider accounting remains separately cost-aware in `ProviderCallLedger`, now account-scoped when the canonical account is available. Locks cover global UTC day, account UTC day/month, and draft/provider cooldown. Optional request keys prevent duplicate provider calls. Provider results record estimated and actual cost settlement without exposing payloads or credentials.

## Entitlement decision order

`src/lib/auth/entitlement-decision.ts` is the pure authoritative decision order. Existing plan and alpha/beta helpers delegate to it.

1. Account enabled.
2. Global kill switch.
3. Feature kill switch.
4. Provider kill switch.
5. Environment capability.
6. Provider availability.
7. Marketplace-specific approval.
8. Admin override for commercial/allowlist gates only.
9. Active/trialing subscription or unexpired grace period.
10. Plan grant.
11. Alpha/beta allowlist.

Stable reason codes are `ACCOUNT_DISABLED`, `GLOBAL_KILL_SWITCH_ACTIVE`, `FEATURE_KILL_SWITCH_ACTIVE`, `PROVIDER_KILL_SWITCH_ACTIVE`, `ENVIRONMENT_CAPABILITY_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `MARKETPLACE_APPROVAL_REQUIRED`, `SUBSCRIPTION_INACTIVE`, `PLAN_FEATURE_REQUIRED`, and `ALPHA_OR_BETA_ACCESS_REQUIRED`. Every denial includes seller-safe copy. Admin cannot bypass account disablement, kill switches, environment capability, provider availability, or external marketplace approval.

## Inventory worker lifecycle and recovery

Automatic jobs use:

```text
queued -> running -> succeeded
                  -> retry_wait -> running
                  -> failed
                  -> needs_review
queued | retry_wait | needs_review -> canceled
```

Claims are conditional transitions from due `queued`/`retry_wait` rows and persist `lockedAt`, `leaseOwner`, and the incremented attempt. Two workers cannot claim the same row. Transient failures use bounded exponential backoff with deterministic jitter. Permanent validation/setup errors become `needs_review` or `failed`; attempts at `maxAttempts` become terminal. Stale running leases enter `retry_wait`, or `failed` when exhausted. Provider text is sanitized before persistence. An automated delist failure also creates a deduplicated manual-review task and seller notification while transient failures continue through `retry_wait`; a marketplace without an automation adapter is never represented as an automated success.

Admin recovery is an authenticated, fail-closed API. Retry is allowed only for `failed`/`needs_review` jobs below `maxAttempts`; cancellation is allowed only before an external operation is running. Both actions append inventory audit evidence when an item is available. A running external operation is never declared canceled or successful.

## eBay sold reconciliation

The installed seller authorization previously requested only Inventory and Account scopes. New authorization and refresh requests include the official `sell.fulfillment` scope, and the client can read orders from a bounded modified-date cursor. Existing connections must reconnect before order polling is possible.

The reconciliation boundary accepts only a caller-verified Fulfillment order signal. It requires an exact account-scoped eBay external-listing match, quantity one, `orderPaymentStatus=PAID`, `cancelState=NONE_REQUESTED`, and a recognized fulfillment status. eBay documents `PAID` as safe for shipment and notes that canceled orders can still be returned by `getOrders`, so cancellation/refund fields are mandatory checks: [Order payment status](https://developer.ebay.com/api-docs/sell/fulfillment/types/sel%3AOrderPaymentStatusEnum), [cancel status](https://developer.ebay.com/api-docs/sell/fulfillment/types/sel%3ACancelStatus), [discovering orders](https://developer.ebay.com/api-docs/sell/static/orders/discovering-unfulfilled-orders.html).

Each signal is deduplicated by account, marketplace, environment, and external event ID. Confirmed signals atomically mark the canonical item and source listing sold, record the sale event, and queue other-channel delists. Duplicate/racing signals are idempotent. Canceled and fully refunded orders record rejection evidence without marking sold. Pending, partial-refund, unverified, quantity-mismatch, or unmatched states create review evidence; uncertain states never auto-delist.

Current limitation: this change does not claim that an eBay Notification subscription, seller reconnection, or production scheduler is active. Until those external capabilities are verified, the safe supported fallback is the durable reconciliation boundary plus seller review tasks. No listing-status-only inference is permitted.

## Environment requirements

No values belong in Git or logs. Existing eBay credential/config variables remain required. Sold polling additionally requires a reauthorized connection whose stored scopes contain `https://api.ebay.com/oauth/api_scope/sell.fulfillment`, a configured internal worker credential, and an explicitly enabled scheduler in the target environment. Provider and marketplace global/feature kill switches remain fail-closed.
