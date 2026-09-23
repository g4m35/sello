# Automatic listing preparation and eBay sale protection

## Seller experience

Upload up to three identification photos and choose **Prepare my listing**. Once identification and saving complete, a persistent job gathers sold comparisons and prepares a price. The upload page must remain open during the initial identification request; the saved job continues after navigation.

**Post to eBay automatically** is optional per item. Starting it records consent, minimum and maximum USD listing price, account, user, and a 24-hour authorization window. It never grants permission for existing inventory or other marketplaces. The eBay seller's configured shipping, return and payment policies apply; the range bounds the listing price, not shipping fees or net proceeds.

Automatic pricing requires at least 90% identification confidence, no identification warnings, high-confidence sold-comp pricing and at least three sold comparisons. USD evidence is required. Known size contradictions are excluded, and missing comparable sizes/style codes cannot receive a strong match. Automatic publication requires single-item inventory and an eBay offer quantity of exactly one. Missing requirements or uncertain outcomes become visible review exceptions.

Automatic posting uses the same account, entitlement, provider-budget, quota, readiness, publishing flag, and idempotency enforcement as manual posting. StockX selections with contradictory style/size are rejected, but StockX and other channels do not acquire automatic posting permission. Unsupported delisting remains a visible manual action.

## Persistent work and concurrency

No schema migration is required. `JobLog` stores listing jobs in `listing-automation-v1`. A compare-and-set claim changes QUEUED to RUNNING once. Both the item and draft versions must still match when the price is saved. The final eBay adapter verifies the authorized item version, draft version, price and quantity and retains resolved required eBay aspects.

An interrupted RUNNING listing job becomes review-required after 15 minutes. It is never blindly replayed: an external provider or marketplace may already have completed work. Check marketplace activity and reconciliation state before another publish. The original per-upload consent expires after 24 hours.

Failed preparation can be explicitly retried through `POST /api/listings/:id/automation` with `{ "action": "retry_preparation" }`. The authenticated active account must still own a single, unsold draft. A transaction links the old failure to one new job; concurrent retries cannot create duplicate work. The new job always has **prepare-only** permission and preserves identification warnings and confidence gates. Provider budgets, cooldowns, quotas and current access remain enforced. It does not regenerate Gemini output, erase uncertain evidence, restore expired publish consent, or post a listing.

New jobs persist a checkpoint before attempting publication. Failures before that checkpoint may offer preparation recovery; failures at or after it cannot. Historical publishing jobs with no trustworthy checkpoint require manual marketplace review. The progress endpoint exposes `recoveryAction: "retry_preparation"` only for eligible failures, and never exposes the stored authorization payload.

Failure and interrupted-job parking create a deduplicated listing review task in the inventory owner's account in the same transaction as the failed status. The existing attention queue can therefore show the failure even after the seller leaves the editor. Explicit retry resolves only that job's review task in the transaction that creates replacement preparation; other sale and delisting tasks remain open.

Only implemented comparison sources participate in runtime discovery or availability reporting. Placeholder adapters for Marketplace Insights, Grailed, Poshmark, Depop and Google Lens are excluded until they have real, tested implementations; enabling their environment flags does not make comparisons available.

Failed uploads permit a new request key only when reservation release is confirmed and the draft-writing transaction never began. Ambiguous network/write outcomes retain the original key. A background completion refresh preserves the seller's unsaved or in-flight editor changes.

## Scheduled execution

`vercel.json` schedules authenticated GET `/api/internal/listing-automation/run` every minute. Configure `CRON_SECRET` on the authorized production deployment. Vercel supplies `Authorization: Bearer <CRON_SECRET>`. An existing external scheduler can instead POST with `x-inventory-sync-worker-secret` using `INVENTORY_SYNC_WORKER_SECRET`. Neither endpoint accepts missing credentials or trusts request-derived destinations.

The worker checks eBay orders, drains up to five guarded inventory-sync jobs (including delisting), then recovers queued listing jobs. Sale protection is prioritized. Work checks a bounded time budget between accounts/jobs; a killed in-flight listing job is parked for review on the next stale-job pass. Claims prevent overlapping scheduler invocations from repeating the same job.

Minute scheduling requires a Vercel plan supporting subdaily cron. Confirm the project's current plan and function duration before release; do not upgrade or purchase services implicitly. Preview deployments do not run Vercel cron. See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Sale monitoring

`ebay-order-poll-v1` uses a per-connection cursor and the configured eBay environment. Current user/account access and the commercial-safety eBay delist entitlement are rechecked before token refresh or order retrieval; subscription expiry alone does not block that safety entitlement. Reconnect older eBay connections if they lack the fulfillment read scope.

Only verified API order signals matching this account's tracked eBay listings enter existing sold-state reconciliation. Missing payment/cancellation/quantity fields are not guessed. The existing reconciliation engine decides which signals can safely mark inventory sold and transactionally create required delisting work.

The first scan covers the last seven days; older pre-existing orders require an initial reconciliation review. Polling covers five connections per invocation in oldest-checked order. This is bounded polling, not instantaneous oversell prevention. Backlogs and provider delays can extend detection time.

Mutable order searches are never traversed with increasing offsets. Only a complete single-page time window is consumed. Oversized windows split at their midpoint with remaining endpoints persisted, and every fetch starts at offset zero. Inclusive boundaries and a two-minute final overlap allow safe duplicate reconciliation. An unsplittable one-second window containing too many orders creates a review alert without advancing the cursor.

Failures retain their cursor, emit an account-scoped notification (deduplicated per connection/day), and produce a non-success scheduler response. Provider outages, denied access, scope gaps and overflow are visible failures, not healthy checks. Already published listings and known sold transitions are not undone by a worker failure.

## Release verification

Code tests use fake providers and placeholder CI environment values; no live listing, sale, delisting, paid provider request, production migration or deployment is part of validation. The UI fixture in the recovery directory renders the actual components with fake seller data and network boundaries, without bypassing deployed authentication.

Before enabling in production, confirm the cron secret/schedule, existing eBay/provider configuration and scopes, permitted seller accounts, and an initial old-order reconciliation. Verify a seller-authorized single listing through publish, sale detection, delisting and activity/notification evidence. This requires separate production-release authorization under the repository AGENTS.md. Rollback or disabling cron stops new scheduled work; it does not undo marketplace listings. Existing publish/provider kill switches remain effective, and active after-response work can finish until its invocation ends.
