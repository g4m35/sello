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

Saved identification warnings and explicit identification-confidence blockers do not offer preparation retry: comparisons cannot resolve those issues. They retain the review task and direct the seller to review the listing instead of repeatedly queuing the same failure.

New jobs persist a checkpoint before attempting publication. Failures before that checkpoint may offer preparation recovery; failures at or after it cannot. Historical publishing jobs with no trustworthy checkpoint require manual marketplace review. The progress endpoint exposes `recoveryAction: "retry_preparation"` only for eligible failures, and never exposes the stored authorization payload.

Failure and interrupted-job parking create a deduplicated listing review task in the inventory owner's account in the same transaction as the failed status. The existing attention queue can therefore show the failure even after the seller leaves the editor. Explicit retry resolves only that job's review task in the transaction that creates replacement preparation; other sale and delisting tasks remain open.

Only implemented comparison sources participate in runtime discovery or availability reporting. Empty adapters for Marketplace Insights, Grailed, Poshmark, Depop, Google Lens and SerpApi have been deleted with their unused configuration. Historical provider labels remain readable, but old enable flags do not make comparisons available.

Failed uploads permit a new request key only when reservation release is confirmed and the draft-writing transaction never began. Ambiguous network/write outcomes retain the original key. A background completion refresh preserves the seller's unsaved or in-flight editor changes.

## Scheduled execution

`vercel.json` schedules authenticated GET `/api/internal/listing-automation/run` every minute. Configure `CRON_SECRET` on the authorized production deployment. Vercel supplies `Authorization: Bearer <CRON_SECRET>`. An existing external scheduler can instead POST with `x-inventory-sync-worker-secret` using `INVENTORY_SYNC_WORKER_SECRET`. Neither endpoint accepts missing credentials or trusts request-derived destinations.

The worker first drains up to five known inventory-sync jobs, checks eBay orders, schedules due StockX checks, drains another five sync jobs, and then processes bulk and listing preparation. Each stage isolates failures so a polling or notification error does not prevent independent queues progressing. Worker summaries containing failed, retrying or review-required jobs produce a non-success scheduler response.

Sync jobs are claimed one at a time immediately before execution. Deadlines stop additional claims rather than leaving an entire batch leased when an invocation runs out of time. Marketplace HTTP requests and response bodies have 15-second timeouts; StockX read retries share that deadline. Deadlines are admission bounds between stages/jobs, not a guarantee that every stage finishes by its target timestamp. Claims prevent overlapping scheduler invocations from repeating the same job.

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


## Durable bulk preparation and seller recovery

Bulk intake commits grouping and durable `bulk-generation-v1` jobs together. The seller can leave after the request succeeds; the cron worker and after-response runner share atomic claims. Each item has a deterministic UUID per generation attempt. Successful identification creates its listing and a prepare-only pricing job in one transaction. Bulk intake never grants automatic publishing consent.

Registration, grouping, claims, cancellation and batch summaries share a per-batch database lock. A canceled batch cannot be reopened by a stale progress write. Cancellation before provider-start prevents the request; already-started work remains subject to usage reconciliation. Interrupted or uncertain work is held for review instead of being charged and generated again automatically.

Inventory shows account-scoped recovery tasks with explicit actions. Sale confirmation resolves its review task, records sold state, and creates required delist work in one transaction. Historical notifications are labeled as history and do not imply that monitoring is currently healthy. The former dashboard capability-based green health indicator and inactive bulk publish selection were removed.

StockX uses recurring status checks described in [StockX monitoring](stockx-status-monitor.md), shared credential refresh with compare-and-set protection against concurrent reconnects, and terminal sold-state protection. An asynchronous removal is successful only after a matching remote listing is confirmed inactive. Pending or ambiguous removals remain review-required; the system does not claim they were removed.

## Remaining operational limits

This is guarded automation, not unattended operation across every marketplace. Historical eBay connections with no saved fulfillment scope require reconnecting once to establish verified permission metadata. Earlier orders outside the initial seven-day scan need reconciliation. Unsupported channels and ambiguous external outcomes require seller review. Automatic posting remains an explicit per-item eBay choice; bulk preparation does not enable it globally. Provider budgets and account entitlements can stop preparation. Existing database schema is unchanged.

## September 23 production rollout

The owner authorized shipping these improvements. Production comparison discovery is enabled for the next deployment, while its admin budget override is explicitly disabled. Existing caps were verified as $5/day overall, 5 provider calls per seller/day and 25/month, with one query variant and ten results maximum. Existing marketplace publishing flags and protected credentials were not changed. This configuration change is not evidence of a successful live provider call.
