# Etsy publish and status safety

The gated Etsy API path creates a durable local listing claim before creating a remote draft. Requests racing that claim cannot both call Etsy. The remote draft ID is persisted before uploading images or activating. A retry with a known ID fetches and resumes that same draft; a verified active response reconciles a previously ambiguous activation. A caught partial/uncertain operation stays NEEDS_REVIEW so a later sale still queues removal. Known-ID retries read the actual saved reservation status and reuse the same reserved usage unit; settled attempts may only reconcile a verified active remote listing, while released attempts require a verified draft before acquiring a fresh unit. They do not consume a second quota slot. The input/photo snapshot must match before reusing uploaded image ranks. Changed or legacy drafts require explicit review.

A create timeout or lost response without a persisted remote ID is **not retryable**: the listing becomes NEEDS_REVIEW, a seller review task is recorded, and the usage reservation remains reconciliation-required. A process crash leaves LISTING blocked. Never clear that state merely to retry. Inspect the Etsy shop and reconcile the remote draft identity before changing the local record. This intentionally trades automatic recovery for duplicate prevention where Etsy supplies no create idempotency guarantee.

Sold/archived/deleting inventory is blocked; activation checks current quantity, sold state, parent version, latest draft identity/version, and the photo snapshot again. Every requested photo must load/upload successfully. Activation requires a response explicitly confirming the same listing is active. Publishing reserves the shared autopublish quota; verified drafts release it, live results settle it, and uncertain outcomes retain it for reconciliation.

Status synchronization uses `markItemSold` for the canonical item, source listing, audit, and cross-channel removal transaction. Conflicting sale sources remain review-required. Non-sale status updates use a snapshot compare-and-set plus canonical unsold conditions; unknown states and stale responses do not revive terminal listings.

This change does not enable Etsy credentials, global switches, or seller allowlists, and does not claim unattended Etsy listing creation. The dedicated publish endpoint still requires seller specifics and explicit confirmation. No live marketplace requests or database migrations are part of validation.

Verified official API requirements (2026-09-23): [request authentication](https://developer.etsy.com/documentation/essentials/requests/) requires `keystring:shared-secret` in the API-key header; [physical listing creation](https://developer.etsy.com/documentation/tutorials/listings/) requires `readiness_state_id`. Configuration now requires the existing `ETSY_CLIENT_SECRET` server variable, and readiness reports a missing processing profile. PKCE token exchange remains unchanged.

Validation uses mocked Etsy/Prisma boundaries: duplicate claim loss, uncertain create quarantine, quota denial, saved-ID ordering, partial image failure, same-ID retry, sold-during-upload, missing activation confirmation, conflicting sale source, stale active response, and wrong remote identity.


## Concurrent inventory changes (PR147 follow-up)

Etsy publishing currently accepts exactly one available unit, because status reconciliation cannot yet account for partial multi-unit sales. Both readiness and the authoritative publish endpoint enforce this restriction. Activation also requires the seller's current delist capability, so automated removal is authorized before a listing can go live.

A saved remote-active retry must pass the same current inventory, draft, and photo checks as new activation. Checks repeat after the activation response and before final persistence. If an edit or sale races activation (including a lost activation response), the request enqueues a due-now removal under `etsy-publish-recovery:<listing-id>:<usage-key>`. This durable key is distinct from the original sale-removal job, which may already have parked after seeing a draft; repeated recovery attempts reuse the new job. The route does not perform inline remote writes. The existing leased worker owns authorization, real sale-conflict holds, verified removal, and visible ambiguous-outcome handling.

Removal rechecks the current canonical sale source and never removes the Etsy sold-source listing. `unavailable` is treated consistently as terminal by the status service, worker, and verified removal helper. Confirmed removal still requires a provider read; an HTTP success alone is insufficient.

Regression evidence includes a stateful remote listing where a sale commits between eligibility and activation, the original removal job is already parked, and a distinct recovery job subsequently deactivates the same listing through the real verified adapter. Variants cover activation timeout and final persistence races, concurrent recovery enqueueing, active retry edits, terminal `unavailable`, and quantity/capability blocks.
