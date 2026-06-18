# Alpha Live Marketplace Actions Design

## Goal

Make Sello's real eBay publishing, bulk publishing, live delisting, and fresh paid sold comps usable in production for selected beta accounts while preserving seller ownership, readiness, idempotency, cost, and secret-handling safeguards.

The beta restriction is temporary. Feature entitlement must remain separate from admin access so a seller can receive live-product access without receiving internal-page access.

## Scope

This rollout includes:

- server-side email allowlists for live eBay publish, eBay delist, and paid comps;
- a real bulk eBay publish preflight and execution flow for all selected eligible items;
- live eBay delist where a stored active eBay listing and offer exist;
- paid sold-comp refresh with identity, quota, budget, cooldown, and ledger controls;
- seller-facing capability and unavailable-state copy;
- admin visibility into configured beta access, provider usage, publish attempts, bulk results, and delist results;
- removal or repair of dead primary actions in the affected inventory, editor, marketplace, and pricing surfaces;
- production configuration, deployment, controlled smoke testing, cleanup, logging review, and rollback documentation.

Inventory synchronization is included only if the audit proves that a complete user-scoped reconciliation implementation exists. Queue schemas or capability placeholders alone do not qualify. If sync is incomplete, Sello will hide the action or explain that live sync is unavailable, and the final report will identify the missing implementation.

No Stripe, marketplace scraping, `prisma db push`, global seller enablement, or unrelated marketplace automation is included.

## Feature Entitlements

Add a server-only feature-access module with three independent entitlements:

| Entitlement | Environment variable | Grants |
| --- | --- | --- |
| Live eBay publish | `LIVE_EBAY_PUBLISH_EMAILS` | Single-item and bulk eBay publish |
| eBay delist | `EBAY_DELIST_EMAILS` | End a stored live eBay listing |
| Paid comps | `PAID_COMPS_EMAILS` | Invoke paid fresh sold-comp providers |

Each variable is a comma-separated, case-insensitive email allowlist. Parsing trims whitespace, removes empty values, and compares normalized email addresses. Missing or malformed configuration fails closed.

`ADMIN_EMAILS` remains exclusively for internal/admin pages. Production will initially copy the current owner/admin email into each feature-specific variable, but application code will not fall back to `ADMIN_EMAILS`. Adding a beta seller therefore requires only adding their email to the relevant feature allowlist.

The authorization API accepts the authenticated server-side user identity, never a client-supplied email. Every mutation route performs its own entitlement check. Client capability flags are display hints only.

## Seller Capability Model

Authenticated seller-facing APIs will expose safe capability booleans and explanatory copy for the current user:

- `liveEbayPublish`
- `ebayDelist`
- `paidComps`

No allowlist contents or environment values are sent to normal users. Non-allowlisted sellers see:

- “Live eBay publishing is currently enabled for selected alpha accounts.”
- “Fresh sold comps are currently enabled for selected alpha accounts.”

Preview, export, mark-ready, search, and manual comps remain available. Unavailable primary actions are either hidden with the alternative action promoted, or visibly disabled with the exact reason; no inert button remains.

## Single-Item eBay Publish

The existing publish path remains the canonical implementation. Before creating marketplace records, publish attempts, or outbound eBay requests, the route must:

1. authenticate the session;
2. authorize the session email against `LIVE_EBAY_PUBLISH_EMAILS`;
3. parse the request;
4. load the item by both item ID and authenticated seller ID;
5. require the item to be in the approved/ready state;
6. run current eBay production environment, connection, seller-policy, inventory-location, image, taxonomy, required-aspect, and listing readiness checks;
7. enforce the existing production kill switch `EBAY_PRODUCTION_PUBLISH_ENABLED`;
8. enforce existing application and database idempotency guards.

The confirmation modal explicitly states that a live eBay listing will be created and requires a checked confirmation. Success persists the eBay SKU, offer ID, listing ID, URL when available, marketplace status, master item status, sync timestamp, and safe event history. Failures persist typed operational detail for admins while normal responses contain only safe codes and seller-facing messages.

## Bulk eBay Publish

Bulk publish uses the same single-item publish service; it does not introduce a second implementation of marketplace rules.

Bulk publish accepts selected ready item IDs for the authenticated seller. The server may process items internally in bounded chunks with low concurrency, but the product does not expose a fixed alpha cap.

Two server endpoints support the flow:

1. A non-publishing preflight accepts the selected item IDs, authenticates the seller, deduplicates IDs, loads only seller-owned items, and runs server-side readiness for every item. Preview remains available to non-allowlisted sellers and reports whether live execution is alpha-enabled for the current account. It makes no live eBay listing mutation; like the existing single-item preflight, it may prepare Sello-managed public image derivatives. It returns selected, ready, blocked, and rejected counts plus safe per-item reasons.
2. An execution endpoint accepts the same selected IDs plus an explicit live-publish confirmation. It re-authenticates, checks `LIVE_EBAY_PUBLISH_EMAILS`, re-loads ownership, and re-checks readiness immediately before each publish.

Items run independently in bounded internal chunks with low concurrency to limit eBay/API pressure and serverless execution time. A failure does not stop later items. Each result is one of `published`, `failed`, `skipped`, or `needs_details`, and includes only safe identifiers and retry eligibility. Duplicate or in-flight items are skipped without another eBay call. Retry is offered only when the canonical publish service says it is safe.

The UI can select all visible or otherwise eligible ready listings and treats the operation as one logical bulk run. If a transport-level request ceiling is required after measuring the production route, it is controlled by a server-only environment variable, set high enough for real seller use, and reported as a safe actionable error. Internal chunk size and concurrency are implementation controls, not product entitlements or seller-visible selection caps.

The inventory selection bar offers “Publish selected to eBay,” “Preview selected,” and the existing CSV export. The modal shows total, ready, blocked, and per-item missing reasons, and requires: “I understand this will create live eBay listings.”

Bulk runs need no new database table for the beta rollout. Existing item-level `PublishAttempt` and `MarketplaceEvent` rows remain authoritative. The API returns a request correlation ID and writes it into each item event so the admin view can group a bulk run without a migration.

## eBay Delist

The existing official eBay withdraw-offer implementation will be enabled only for sessions authorized by `EBAY_DELIST_EMAILS` and only when all existing safety conditions pass:

- the item belongs to the authenticated seller;
- the current-environment marketplace artifact is `LISTED`;
- stored eBay offer and listing IDs exist;
- no delist is already running;
- explicit live-delist confirmation is present;
- token refresh and official API access succeed.

The entitlement check happens before any delist attempt is created. Success marks the marketplace listing delisted and reconciles the master item. Failure restores the local listing to `LISTED`, records a typed failed attempt/event, and returns sanitized copy.

Draft deletion remains local and must refuse to silently delete a live marketplace listing. Bulk delete must partition or reject selected active items rather than cascading away live marketplace artifacts.

No additional delist environment kill switch is required for beta access: `EBAY_DELIST_EMAILS` is the dedicated kill switch. Removing all entries disables live delist immediately after redeployment. If operational review favors a boolean emergency switch, it may be added in addition to—not instead of—the allowlist.

## Fresh Paid Sold Comps

Paid refresh requires both:

- the authenticated email is present in `PAID_COMPS_EMAILS`; and
- all existing provider enablement, credential, budget, quota, cooldown, and ledger gates pass.

The current manual refresh `force` behavior must not bypass identity quality. Weak or generic items skip paid providers with a seller-facing explanation and a zero-cost ledger row. Manual comps remain available regardless of entitlement or exhausted budgets.

Initial production posture:

- `COMPS_PAID_PROVIDERS_ENABLED`: enabled;
- `COMPS_APIFY_EBAY_SOLD_ENABLED`: enabled when provider credentials are present;
- `COMPS_AUTO_DISCOVERY_ENABLED`: enabled only after the controlled manual-refresh smoke proves identity gating, cost accounting, and result quality;
- global daily estimated provider budget: $5;
- per-user daily paid refresh limit: 5;
- per-user monthly paid refresh limit: 25;
- per-draft paid-provider cooldown: 1 hour;
- manual refresh cooldown: 1 hour;
- maximum provider results: 10–20, choosing 10 for the first rollout;
- maximum query variants: 1;
- strict identity threshold retained and validated against strong and generic fixtures;
- admin override disabled.

The paid provider is never named to normal sellers. Provider identifiers, costs, skip reasons, and failure detail remain in the admin usage surface and server logs. Provider failures return generic seller copy and never expose provider response text.

## Admin Operations Visibility

The existing admin boundary remains controlled by `ADMIN_EMAILS`. Extend the admin operations surface with read-only data for:

- normalized members of each feature allowlist;
- paid-provider calls, estimated cost, result counts, skips, and failures;
- single and bulk publish attempts grouped by correlation ID where present;
- eBay listing, offer, and attempt status;
- delist attempts and results.

Admin APIs remain server-rendered or independently admin-authenticated, validate query inputs, and return generic failures. Secret values, OAuth tokens, encrypted tokens, raw provider payloads, and raw eBay payloads are excluded.

## Dead-Action and Marketplace UI Audit

The rollout will inspect the editor, inventory, dashboard, marketplace settings, marketplace overview, pricing panel, publish modal, and delete/delist controls.

Required outcomes include:

- eBay connect/reconnect links to the working marketplace settings flow;
- live publish copy reflects the current seller entitlement and global kill switch;
- inventory bulk publish uses every selected row, not only the first selected item;
- CSV export remains available and is no longer labeled as future work;
- refresh comps either runs, counts down a cooldown, or explains alpha access/identity/budget limits;
- manual comps always remain actionable;
- draft delete/archive is distinct from ending a live eBay listing;
- sync controls appear only if real reconciliation exists;
- no clickable primary control lacks an effect.

## Error and Audit Model

Authorization denials use a stable safe code and HTTP 403. Readiness and ownership failures preserve the existing 404/409/422 semantics. Bulk responses use safe per-item result objects rather than raw thrown exceptions.

Detailed provider/eBay errors may be persisted in restricted operational records when already sanitized by the adapter, but normal routes and UI never return raw upstream bodies, database errors, tokens, secrets, environment values, or internal provider IDs. Logs use stable event names and IDs rather than credentials or payload dumps.

## Testing Strategy

Implementation follows test-first changes for each boundary:

- allowlist parsing, normalization, missing-user-email, and fail-closed behavior;
- route-level server enforcement for every feature;
- non-allowlisted requests cause no persistence or outbound call;
- single publish ownership, readiness, connection, policy, duplicate, sanitized-failure, and success behavior;
- bulk selection across all eligible items, configurable transport ceilings if required, internal chunking, deduplication, ownership, readiness, independent results, duplicate protection, and safe retry behavior;
- delist ownership, artifact, confirmation, idempotency, failure restoration, and sanitization;
- paid comp entitlement, strong identity, weak identity, budget, daily/monthly quota, both cooldowns, ledger state, provider failure, and manual comp independence;
- seller capability copy and absence of dead controls;
- admin-only operational visibility and secret-field exclusion;
- inventory sync capability honesty.

The final local gate is `npx prisma validate`, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`. No schema migration is expected for this design; existing publish/event/ledger tables are sufficient.

## Production Rollout

Before changing production:

1. record the current production deployment ID as rollback target;
2. verify production environment variables by name only;
3. confirm the feature branch has passed review and the full gate;
4. promote through `feature/* -> develop -> main` without dropping unrelated user work;
5. configure the three feature allowlists with the owner email and apply the agreed comp caps;
6. keep `EBAY_PRODUCTION_PUBLISH_ENABLED` and paid providers disabled until the new code is serving production;
7. enable the gates, redeploy, and run controlled signed-in smoke tests.

Smoke uses clearly disposable test listings, explicit confirmations, item-level verification, Seller Hub verification where available, and cleanup through live delist or orphan cleanup as appropriate. Bulk publish uses two ready test items and proves duplicate prevention. Paid comps use one strong branded item and one weak generic item, then verify ledger/cost/cooldown state. Logs are scanned for failures and secret-like output.

If a critical issue appears, remove the relevant allowlist entries or disable the existing global kill switch first, redeploy if required, and promote the recorded previous deployment if the application itself is unhealthy. The final report states failures plainly and proves cleanup of temporary marketplace artifacts.

## Acceptance Mapping

- Owner/admin receives real feature access through the three feature-specific allowlists.
- A beta seller can be added without becoming an admin.
- Non-allowlisted sellers receive useful alpha-access copy and retain preview/export/manual workflows.
- Every costly or marketplace-mutating action is re-authorized server-side.
- Single and bulk publish reuse ownership, readiness, production, and duplicate guards.
- Paid comps retain budget, quota, cooldown, identity, and ledger controls.
- Live delist operates only on owned stored live artifacts with explicit confirmation.
- Admins can inspect beta access and operational outcomes without secret exposure.
- No feature is globally enabled for every authenticated seller.
