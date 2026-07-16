# Sello paid-beta implementation plan

Date: 2026-07-09 (America/Los_Angeles)
Repository reviewed: `/Users/jheller/dev/resale-crosslister-clean`
Baseline reviewed: `main` at `1335be1` (`Simplify marketplace UI and strip redundant app chrome`)
Scope: implementation package only. No deployment, environment mutation, provider call, or marketplace write was performed.

> Implementation update (2026-07-10): durable bulk intake is now present on `develop`, and the paid-beta P0 hardening is specified by `docs/architecture/bulk-intake-paid-beta-readiness.md` with rollout/recovery in `docs/operations/paid-beta-production-rollout.md`. This dated plan remains useful design context, but its baseline commit, test totals, migration state, and “missing” diagnoses are historical and must not be used as current rollout evidence.

## Ground truth and decision rules

This plan is based on the current repository, its migrations, route/service tests, `AGENTS.md`, `HANDOFF.md`, and current official marketplace documentation. It does not treat old roadmap prose as current when code and migrations disagree.

Non-negotiable rules:

- One account-owned `InventoryItem` is the source of truth; marketplace listings are projections.
- Use **listing** consistently; avoid weak draft-oriented product language.
- Every external write is explicit, server-authorized, idempotent, environment-bound, budgeted where paid, and audited.
- Missing config, eligibility, plan state, approval, or marketplace capability fails closed.
- A failure either supplies a seller action, queues a retry, or creates a `ReviewTask`; it never disappears.
- No browser bot, unapproved consumer/private endpoint, CAPTCHA bypass, or credential harvesting. “Assisted” means seller-controlled copy/export/open-link steps. An official private partner API may be used only after written access and terms approval.
- Do not deploy, publish, delist, change environment variables, or run paid providers without separate owner approval.

### Current verification caveats

- `npm run lint` completed with two existing unused-variable warnings.
- On 2026-07-10, the StockX mock-signature blocker was fixed and the complete gate passed: typecheck; lint with the two existing warnings; 212 test files / 1,440 tests; and production build.
- The required Lazyweb quick searches and live `/pricing` screenshot succeeded. The required full-report upload endpoint returned HTTP 429 twice; no ungrounded or inline-image fallback was used.

## 1. Executive diagnosis

### Already present and worth preserving

- Next.js 16 / React 19 / strict TypeScript, Prisma 7, Postgres/Supabase, Supabase Auth and Storage.
- Account membership, Stripe Checkout/Portal/webhook handling, Free/Pro/Kingpin catalog, usage counters, connection and batch limits.
- Multi-photo single-item upload, Gemini extraction, Zod-validated listing data, editable `ListingDraft`, autosave/lifecycle/readiness.
- Real comp pipeline with manual comps, Apify eBay sold comps, StockX bid/ask market signals, scoring, cooldowns, advisory-lock provider reservations, cost ledger, and honest no-data states.
- eBay OAuth, encrypted tokens, seller policy/location readiness, public marketplace media, Taxonomy aspects, dry-run preview, guarded production publish, duplicate defenses, delist, audit persistence, sandbox/production separation.
- StockX OAuth/catalog/variant match, market data, create/activate/deactivate, status reconciliation, bulk preflight/publish, and hard kill switches. Live use still requires verified StockX developer access, seller/account eligibility, configuration, and explicit approval.
- Etsy gated foundation; copy-ready exports for unsupported channels.
- Transaction-safe `markItemSold`, optimistic `lockVersion`, durable `SyncJob`, `InventoryEvent`, `ReviewTask`, `Notification`, email-signal parsing, and eBay/StockX delist workers.
- Admin feedback, provider usage, and marketplace-operations pages with fail-closed server-side admin checks.
- A large Vitest suite and migration contract tests.

### Missing or incomplete

- Durable account-scoped bulk photo intake, grouping, per-item AI generation, resumable review, cancellation, and canonical listing conversion are now implemented. Publishing remains a separate existing single/bulk execution path and bulk-intake itself performs no marketplace write.
- Paid product access is split between plan entitlements and alpha email allowlists. A paying seller can still be denied paid comps/live actions; the pricing page cannot truthfully describe effective access.
- Usage quota check and increment are separate and best-effort. Concurrent requests can exceed plan limits or complete without being metered.
- `SyncJob` retry semantics are not production-grade: several job kinds are `NOT_IMPLEMENTED`; non-delist failures go terminal immediately; `needs_review` is never claimed although one comment describes it as retryable; no exponential backoff or retry classification exists.
- eBay `detect_status`/order reconciliation is missing; the worker only reconciles StockX. Current eBay OAuth scopes include inventory/account, not the Fulfillment scope needed for order polling.
- TikTok Shop is labeled `full_native` and queue-eligible while the adapter is a typed stub. This is honest at execution but misleading at capability/UI boundaries.
- Depop product copy is stale. Depop now documents a private Partner Selling API with OAuth for cross-listing tools; it is partner-gated, not nonexistent.
- Vinted Pro is a real allowlisted API but remains a scaffold. Grailed and Poshmark should remain manual; no approved public listing API was verified. General apparel publishing to Facebook Marketplace was not verified through an official public API.
- No cross-domain `AuditLog`, append-only usage event, webhook event key on all marketplace events, job priority/lease ownership, notification delivery worker, or operator kill-switch UI.
- Admin coverage is partial: no account/billing/batch/job/audit/notification/review-task consoles.

### Ranked paid-beta blockers

| Severity | Blocker | Exit condition |
|---|---|---|
| P0 | No durable bulk intake/review flow | 10-item default batch works end to end; refresh/retry/resume and partial failures are tested |
| P0 | Plan/allowlist/kill-switch divergence | one server-side effective-capability resolver drives APIs and UI; paying never implies unavailable partner access |
| P0 | Non-atomic usage enforcement | idempotent usage reservations enforce quota under concurrency and settle/refund deterministically |
| P0 | Incomplete worker retry and eBay sold reconciliation | retry/backoff/reaper work; eBay orders/status can atomically mark sold and queue other-channel delists |
| P0 | Capability truth errors | TikTok downgraded until implemented; Depop changed to partner-gated; no unsupported channel is queue-eligible |
| P1 | StockX operational eligibility and async operations | approved account, exact match, operation polling, order sync, condition/region rules, controlled smoke |
| P1 | Review task and notification product surface | sellers can see, resolve, dismiss, and deep-link every required action |
| P1 | Admin/operator coverage | failed jobs, batches, accounts, billing, marketplace health, audit, and kill switches are visible and safe |
| P1 | Cross-domain immutable audit | every live write, sold decision, delist, admin retry, billing change, and entitlement decision is queryable |
| P2 | Partner-gated Depop/Vinted/TikTok adapters | implement only after written access, test credentials, terms review, and capability probe |
| P2 | Growth analytics and advanced automation | only after paid-beta safety SLOs hold |

Paid-beta go/no-go: no P0 open; no live marketplace action without an adapter contract test and kill switch; delist failure creates a seller task within one worker cycle; billing events are replay-safe; the complete gate is green.

## 2. Product definition

### Single item

1. Seller selects 1–12 photos. Client validates type/size/count, uploads directly with signed paths, and shows per-file progress/retry.
2. Server creates one `InventoryItem` in `DRAFTING`, ordered photos, and an idempotent AI job.
3. AI proposes identity, condition, title, description, specifics, flaws, and marketplace mappings. Unknown size/authenticity/hidden flaws remain explicit questions.
4. Seller lands on `/inventory/:id` with one primary readiness state: **Needs review**, **Ready to list**, **Live**, **Sold**, or **Action required**.
5. Comp evidence loads independently. No provider fetch is triggered by passive page loads.
6. Seller approves price and marketplace-specific required fields, previews exact outbound payload, then confirms each live channel write.

### Bulk upload

1. `/inventory/bulk` starts a batch capped by the effective plan; default seller-visible batch limit is 10.
2. Seller uploads photos, then groups them into item cards. AI may suggest groups, but low-confidence grouping never merges photos automatically.
3. Each item processes independently. The batch page survives refresh and reports `7 ready · 2 need review · 1 failed`.
4. Grid editing supports brand, category, size, condition, price, marketplace selection, and apply-to-selected. Authenticity, flaws, and exact catalog match cannot be mass-confirmed unless values are identical and explicitly selected.
5. Bulk comps run only for strong identities and within provider/account budgets.
6. Preflight is side-effect free. Execution uses the existing per-item canonical publish handler; partial success never rolls back already-live external listings.
7. Retry targets failed/retryable items only and reuses the same idempotency keys.

### Publish, sync, sold, and review

- Channel cards report **Live API**, **Partner access required**, **Exact catalog match required**, or **Copy-ready**—not aspirational capability.
- Every live publish shows channel, quantity (`Quantity: 1`), price, environment, and final confirmation.
- A confirmed sale locks the item, sets quantity to zero, records the source, and atomically queues delists for every other live listing.
- Unsupported delists create an urgent task with marketplace, item, direct listing URL, and **Mark removed** confirmation.
- Conflicting sale signals never overwrite the first sale; they create a high-priority review task.
- Notifications have in-app delivery first; email is optional and deduped through an outbox.

### Billing and operator experience

- Free proves the full photo-to-listing workflow; plan limits are visible before work begins and at the point of use.
- An upgrade changes plan limits, not marketplace partner eligibility. The UI says both when necessary: “Included in Pro · Depop partner access still required.”
- Account owner/admin controls billing and connections; members can create/edit listings subject to account limits.
- Operators see health and sanitized failure codes, can retry safe terminal jobs, cancel queued work, disable a provider/channel, and never view raw tokens or provider payloads.

## 3. System architecture

### Pages

Preserve: `/dashboard`, `/inventory`, `/inventory/new`, `/inventory/[id]`, `/channels`, `/history`, `/settings/marketplaces`, `/settings/billing`, existing admin pages.

Add:

- `/inventory/bulk` and `/inventory/bulk/[batchId]`
- `/tasks` and `/notifications`
- `/admin/jobs`, `/admin/marketplace-health`, `/admin/accounts`, `/admin/billing`, `/admin/bulk-batches`, `/admin/review-tasks`, `/admin/audit`, `/admin/kill-switches`

### API routes

- `POST /api/bulk-uploads`; `GET /api/bulk-uploads/[batchId]`; `POST .../cancel`
- `POST /api/bulk-uploads/[batchId]/photos/presign`; `POST .../photos/complete`
- `POST /api/bulk-uploads/[batchId]/groups`; `PATCH /items/[bulkItemId]`
- `POST /api/bulk-uploads/[batchId]/process`; `POST .../retry`
- `POST /api/bulk-uploads/[batchId]/comps`; `POST .../publish/preflight`; `POST .../publish`
- `GET/PATCH /api/review-tasks`; `GET/PATCH /api/notifications`
- Official webhook routes per marketplace, each with raw-body verification, event dedupe, and fast acknowledgement.
- Internal worker routes only as scheduler triggers; actual work is claimed from durable DB/Redis queues.

### Core services

`listing/`, `bulk-intake/`, `pricing/`, `marketplace/`, `inventory/`, `billing/`, `notifications/`, `audit/`, and `jobs/`. Route handlers authenticate, validate, resolve account/effective capability, and call services; they do not contain marketplace algorithms.

### Workers and queues

- `bulk-intake-ai`: photo grouping confirmation -> item extraction.
- `price-comps`: provider reservations, fetch, normalization, scoring.
- `marketplace-publish`: publish/update/delist operations.
- `marketplace-sync`: order/listing reconciliation and sold decisions.
- `notification-delivery`: in-app outbox and email delivery.
- `maintenance`: stale lease reaper, abandoned upload cleanup, reconciliation cursors.

Use Postgres rows as the durable truth and BullMQ/Redis only as a wake-up/dispatch accelerator. Enqueue transactionally via an outbox or poll queued rows, so a Redis outage cannot lose work.

```text
Browser
  -> Next.js routes -> auth + account scope + effective capability + Zod
       -> domain transaction (Prisma/Postgres)
            -> InventoryItem / ListingDraft / Batch / Usage reservation
            -> PublishJob or SyncJob + AuditLog + OutboxEvent
                 -> worker claims lease
                      -> marketplace adapter / AI / comp provider
                      -> typed result + retry or terminal state
                      -> MarketplaceListing / InventoryEvent / ReviewTask
                           -> notification outbox -> in-app/email

Marketplace webhook/order poll
  -> signature + event dedupe -> sale signal
       -> lock InventoryItem -> SOLD + quantity 0
            -> delist jobs for every other live listing
```

## 4. Database schema plan

Do not perform cosmetic table renames during paid beta. The logical names below map to current physical models where noted.

| Logical model | Current mapping / required changes | Key constraints and indexes | Security |
|---|---|---|---|
| `Account` | Keep. Add `status`, `timeZone`, `currency`, `riskState` | unique `ownerUserId`; index `plan,status` | subscription/usage owner; all queries account-scoped |
| `User` | Add profile-only row keyed to Supabase `auth.users.id`; no passwords/tokens. Fields `id, displayName, locale, timeZone, createdAt, updatedAt` | PK/FK id; no duplicated auth secret | RLS deny-all to browser or membership policy later |
| `InventoryItem` | Keep. Add `accountId NOT NULL`, `sourceBatchItemId`, `currency`, `version`; keep quantity/lockVersion/sold source | index `(accountId,status,updatedAt)`; unique source batch item | account is authority; sellerId is creator, not tenant boundary |
| `Listing` | Evolve current `ListingDraft`; do not add an ambiguous third table. Add `version`, `approvedBy`, `contentHash`, `readinessSnapshot`, `currency` | unique current version per item or `(inventoryItemId,version)` | item/account relation owns it |
| `ListingPhoto` | Evolve `ItemPhoto`; add `bulkUploadItemId?`, `checksum`, `byteSize`, `width`, `height`, `uploadStatus`, `scanStatus` | unique bucket/path; unique checksum per batch item as appropriate; `(inventoryItemId,position)` | signed upload path embeds account/batch; server finalizes |
| `MarketplaceConnection` | Keep encrypted tokens; add `tokenKeyVersion`, `status`, `lastVerifiedAt`, `capabilitySnapshot` | existing unique account/marketplace/environment | owner/admin mutation only; never serialize ciphertext |
| `MarketplaceListing` | Keep. Add `accountId`, `remoteVersion`, `lastRemoteEventId`, `syncCursor`, `quantity`, `currency` | existing unique item/channel/env; unique remote id when non-null by channel/env | account scope on every lookup |
| `PublishJob` | Evolve `PublishAttempt` add `operation`, `attempts`, `maxAttempts`, `runAfter`, `lockedAt`, `leaseOwner`, `priority`, `requestId`, `payloadSnapshotHash` | partial unique active/succeeded idempotency; `(status,runAfter,priority)` | payload sanitized; actor/requestedBy required |
| `SyncJob` | Keep; add `accountId`, `marketplace`, `retryClass`, `lockedAt`, `leaseOwner`, `priority`, `completedAt` and explicit `retry_wait`/`canceled` states | unique idempotency key; `(status,runAfter,priority)` | worker revalidates account/item/listing ownership |
| `InventoryEvent` | Keep domain audit; add `accountId`, `externalEventId`, `correlationId` | unique `(marketplace,externalEventId,type)` when present; `(accountId,createdAt)` | immutable, sanitized payload |
| `PriceComp` | Keep; add `identityKey`, `evidenceClass` (`sold`,`active`,`bid_ask`,`manual`), `providerFetchedAt`, `expiresAt` | source/external id unique when present; `(inventoryItemId,usedInPricing)` | provider terms govern cross-account cache reuse |
| `PriceCompRun` | Rename logical `CompSearchRun`; add account, budget decision, algorithm version, dispersion/sample metrics | `(accountId,createdAt)`, `(inventoryItemId,createdAt)` | no raw provider secrets |
| `ProviderCallLedger` | Keep reservation pattern; change `userId` authority to `accountId`, add `actualCostCents`, `requestId`, `settledAt` | unique provider request/idempotency key; daily account/provider index | append/settle only; admin aggregate is sanitized |
| `BulkUploadBatch` | New fields below | `(accountId,status,updatedAt)`; unique client idempotency key | owner account; plan reserved at creation |
| `BulkUploadItem` | New fields below | unique `(batchId,position)` and optional `inventoryItemId`; `(batchId,status)` | item cannot move across accounts |
| `ReviewTask` | Keep; add `accountId`, `priority`, `dueAt`, `dedupeKey`, `resolution`, `resolvedBy` | unique open dedupe key; `(accountId,status,priority,dueAt)` | seller/member scope; admin actions audited |
| `Notification` | Keep; add `accountId`, `dedupeKey`, `channel`, `deliveryStatus`, `actionUrl` | unique `(accountId,dedupeKey)`; unread index | body is seller-safe; no provider payload |
| `EmailSignal` | Keep; add `accountId`, `provider`, `signatureVerified`, `rawObjectRef?`, `eventTime` | existing message-id unique; `(accountId,processedAt)` | provider signature required upstream; minimize snippets |
| `BillingSubscription` | Evolve `Subscription`; add `lastStripeEventCreated`, `graceEndsAt` | Stripe customer/subscription unique | owner/admin reads; server webhook writes |
| `UsageMeterEvent` | New append-only reservation/settlement record | unique idempotency key; `(accountId,metric,periodStart,status)` | atomic quota authority; no client writes |
| `AuditLog` | New append-only cross-domain log | `(accountId,createdAt)`, `(targetType,targetId)`, unique event id | no update/delete API; redact before insert |

Required enums:

```text
BulkUploadBatchStatus = CREATED UPLOADING GROUPING PROCESSING REVIEW_REQUIRED READY
                        PUBLISH_QUEUED PUBLISHING COMPLETED PARTIAL_FAILURE FAILED CANCELED
BulkUploadItemStatus  = EMPTY UPLOADING UPLOADED QUEUED_AI PROCESSING_AI AI_FAILED
                        REVIEW_REQUIRED READY PUBLISH_QUEUED PUBLISHING PUBLISHED
                        PARTIAL_FAILURE FAILED SKIPPED CANCELED
JobStatus             = QUEUED RUNNING RETRY_WAIT SUCCEEDED FAILED NEEDS_REVIEW CANCELED
UsageMeterStatus      = RESERVED SETTLED RELEASED EXPIRED
AuditActorType        = USER ADMIN WORKER WEBHOOK SYSTEM
```

State aggregates are derived transactionally: a batch is `REVIEW_REQUIRED` if any nonterminal item needs review; `READY` only when at least one item is ready and none is processing; `PARTIAL_FAILURE` when successful/published items coexist with terminal failures; `COMPLETED` when every item is published/skipped or the seller explicitly completes without publishing.

RLS: preserve the current server-only Prisma posture and RLS deny-all for browser roles. Before any direct Supabase table query, add account-membership policies using `(select auth.uid())`; do not fall back to creator `sellerId`. Verify the runtime role still bypasses RLS in preview before migration deploy.

## 5. Marketplace autonomy matrix

Status is verified as of this plan date and must be rechecked against official docs and the seller account before implementation.

| Marketplace | Official automation | Must not automate | Fallback / sold / delist | Risk | Paid-beta readiness |
|---|---|---|---|---|---|
| eBay | Sell Inventory creates inventory/offer/publish/withdraw; Account policies; Fulfillment orders; Notification API | publish without explicit confirmation; cross environment; assume order from listing status alone | Full API. Poll orders/status until notifications are proven. Delist via official offer/listing operation and reconcile. | Medium | **Ready after eBay sold-sync + worker retry P0** |
| StockX | Official Public API supports OAuth + API key, catalog, listings/asks, async operations, orders, market data, and batch APIs after developer access approval | assume Sello or a seller is approved/eligible; fuzzy catalog publish; call bid/ask data “sold comps”; assume used/DIRECT eligibility | Copy-ready when access, seller eligibility, or match is missing. Poll operations and orders; deactivate/delete officially only after approval. | High | **Conditional pilot after access and eligibility verification** |
| Depop | Official private Partner Selling API supports approved OAuth cross-listing tools, product CRUD, orders, and webhooks | claim general availability; build before written partner approval; use private consumer endpoints | Until Depop approves Sello: copy-ready + manual listing URL + email signals. After written approval: verified order webhook and idempotent mark-sold/delete. | High | **Assisted now; API beta only after approval** |
| Vinted | Vinted Pro Integrations supports allowlisted business item management, webhooks/status, orders/labels, and dev mode | imply Sello is allowlisted; consumer-account automation; exceed slots; assume country/business eligibility | Assisted until Sello and the seller meet the Pro allowlist and regional eligibility requirements. Then use the signed API per contract. | High | **Assisted now; verify allowlist and eligibility** |
| TikTok Shop | Official Partner APIs can manage products, review status, orders, and webhooks for approved apps/shops in supported regions; Sello’s current adapter is a stub | label current Sello integration native; assume app/shop/region eligibility; bypass category/audit/compliance | Copy-ready/export until access, region, shop eligibility, and a real adapter are verified. Only then use verified order states and Product API writes. | High | **Not API-ready; downgrade registry** |
| Grailed | No approved public listing API verified | private APIs, bots, scraping, refresh automation; Grailed warns against bot/private-API exploitation | Copy-ready, photo checklist, open listing page. Sold email/manual confirmation; manual delist task. | High | **Assisted only** |
| Poshmark | No approved public listing API verified | scraping/crawling/automated systems; browser bots; auto-sharing | Copy-ready, CSV where officially supported by seller tooling, email/manual sold confirmation, manual delist task. | Very high | **Assisted only** |
| Facebook Marketplace | No official general fashion-resale listing API verified; Meta commerce/catalog access does not by itself prove consumer Marketplace placement | Graph/private endpoint assumptions, account automation, scraping | Copy-ready/open flow, manual URL attach, email/manual sold confirmation and delist task. | Very high | **Assisted only; verify written partner path** |

Etsy remains an existing Sello channel but was not requested in this matrix; keep its current gated official-API behavior and copy-ready fallback.

Official references: [eBay Inventory API](https://developer.ebay.com/develop/api/sell/inventory_api), [eBay Fulfillment API](https://developer.ebay.com/develop/api/sell/fulfillment_api), [eBay Notification API](https://developer.ebay.com/develop/api/sell/notification_api), [StockX API introduction](https://developer.stockx.com/portal/api-introduction), [StockX reference](https://developer.stockx.com/portal/api-reference), [Depop Partner API](https://partnerapi.depop.com/api-docs/reference/), [Depop OAuth/partner access](https://partnerapi.depop.com/api-docs/concepts/authentication/), [Vinted Pro Integrations](https://pro-docs.svc.vinted.com/), [TikTok Shop Products API](https://partner.tiktokshop.com/docv2/page/products-api-overview), [TikTok webhooks](https://partner.tiktokshop.com/docv2/page/tts-webhooks-overview), [Grailed conduct](https://support.grailed.com/hc/en-us/articles/27294980902029-What-is-the-Code-of-Conduct), [Poshmark terms](https://www.poshmark.com/terms).

## 6. eBay full flow

1. **Connect:** request only required scopes; add `sell.fulfillment` for order reconciliation. Store granted scopes and show reconnect-required when insufficient. HMAC state remains short-lived, HttpOnly/SameSite/Secure, bound to user/account/environment; add a one-time hashed nonce row to stop callback replay and support multiple tabs.
2. **Readiness:** validate connection/token, environment, marketplace, account policies, enabled inventory location, public derivative photos, category, condition, price, quantity exactly 1, title/description policy, required Taxonomy aspects, seller confirmation, plan/feature/global gate. `GET readiness` is stored state; `POST readiness` performs live refresh.
3. **Category/aspects:** use local deterministic mapping first, eBay category suggestions for ambiguity, `getItemAspectsForCategory` with TTL cache, and seller-friendly fields. Never send a guessed required aspect.
4. **Publish:** generate deterministic environment-specific SKU; transactionally reserve `PublishJob` and usage; re-read item state; upsert inventory item; create/recover offer; publish offer; reconcile returned offer/listing IDs; settle usage and audit. Store exact outbound snapshot hash, not secrets.
5. **Duplicate prevention:** unique local item/channel/environment, active/succeeded idempotency key, content hash, remote `getOffers`/SKU recovery before any second create, and a “remote outcome unknown” reconciliation state after timeouts.
6. **Status/sold:** poll Fulfillment `getOrders` from a durable cursor and optionally consume verified notifications. Deduplicate by order/line item; map SKU/listing to one account item; only paid/confirmed sale states call atomic `markItemSold`.
7. **Delist:** queue operation, revalidate that item is sold or seller explicitly confirmed, withdraw/end using the official Inventory operation, then read remote state. A timeout remains `RETRY_WAIT`, never success.
8. **Errors:** typed `AUTH_EXPIRED`, `READINESS_FAILED`, `POLICY_MISSING`, `ASPECT_REQUIRED`, `DUPLICATE`, `RATE_LIMITED`, `REMOTE_OUTCOME_UNKNOWN`, `REMOTE_REJECTED`, `DELIST_FAILED`; provider text is sanitized and stored server-side only when safe.
9. **Environment:** credentials, state, connection, SKU, rows, URLs, gates, and tests are environment-specific. Production flag absent/false is a hard stop.
10. **Tests:** OAuth state replay/expiry/scope upgrade; policy/location gaps; taxonomy cache; all required specifics; public image; duplicate concurrent publish; timeout after remote success; order replay; two simultaneous sales; delist retry; sandbox/prod collision; sanitized error copy.

## 7. StockX full implementation

Preserve the existing OAuth/catalog/market-data/listing/status code, then close these gaps:

1. Require documented developer approval, API key, OAuth app, approved redirect, seller payout/shipping readiness, and exact environment config before exposing Connect.
2. Search by style code/GTIN first, then normalized brand/model/colorway. Candidate selection requires seller confirmation unless a verified identifier and exact variant match make confidence 1.0.
3. Persist product and variant IDs, StockX size label, size system, match source/version, and who confirmed it. Invalidating brand/style/size clears the match.
4. Treat StockX market data as **bid/ask guidance**, not sold history. Store `evidenceClass=bid_ask`; never let it alone produce “high sold-comp confidence.”
5. Make create/activate/deactivate asynchronous: persist operation ID/URL/status, poll with bounded backoff, reconcile listing state, and handle success-after-timeout without replaying create.
6. Poll active/history orders and listing/order association. A verified order state marks the canonical item sold; `DONOTSHIP`, canceled, suspended, or ambiguous states create tasks rather than false sales.
7. Default condition/inventory type to the subset confirmed for the seller/region. Used and DIRECT/verified-seller support stays disabled until account eligibility and current API contract are tested.
8. Fallback: retain exact catalog match, bid/ask guidance, copy-ready ask details, and a direct StockX link; do not show a fake Publish control.
9. Safety: one quantity, seller confirmation, price currency validation, min/max guardrails, duplicate listing lookup, daily/batch rate budgets, kill switches for API, market data, listing, and sold sync independently.
10. Required env names (values never printed): `STOCKX_API_ENABLED`, `STOCKX_CLIENT_ID`, `STOCKX_CLIENT_SECRET`, `STOCKX_REDIRECT_URI`, `STOCKX_TOKEN_ENCRYPTION_KEY`, `STOCKX_OAUTH_STATE_SECRET`, `STOCKX_API_KEY`, `STOCKX_AUTH_BASE_URL`, `STOCKX_API_BASE_URL`, `STOCKX_SCOPES`, `STOCKX_MARKET_DATA_ENABLED`, `STOCKX_LISTING_ENABLED`; add `STOCKX_ORDER_SYNC_ENABLED`.
11. Tests: exact/fuzzy match, size conversions, match invalidation, unsupported condition, incomplete seller profile, async pending/success/failure, operation timeout, duplicate create, order replay/status matrix, delist fallback, token refresh race, 429 backoff, kill switches, account isolation, and no “sold comps” label for bid/ask data.

## 8. Bulk upload system

### State machine

```text
Batch: CREATED -> UPLOADING -> GROUPING -> PROCESSING
       -> REVIEW_REQUIRED <-> PROCESSING -> READY
       -> PUBLISH_QUEUED -> PUBLISHING -> COMPLETED | PARTIAL_FAILURE
       any nonterminal -> CANCELED; unrecoverable system failure -> FAILED

Item: EMPTY -> UPLOADING -> UPLOADED -> QUEUED_AI -> PROCESSING_AI
      -> REVIEW_REQUIRED | READY | AI_FAILED
      REVIEW_REQUIRED -> QUEUED_AI (retry) | READY (seller fixes)
      READY -> PUBLISH_QUEUED -> PUBLISHING -> PUBLISHED | PARTIAL_FAILURE | FAILED
      any nonterminal -> CANCELED; excluded item -> SKIPPED
```

### Implementation

- Create the batch and reserve plan capacity before issuing signed uploads. Signed keys are `account/batch/photo`; completion verifies path, MIME, size, checksum, ownership, and object existence.
- Photos start ungrouped. Seller drag/drop is authoritative. AI grouping suggestions contain confidence and explanation; cross-item duplicates are flagged.
- Each group creates one `BulkUploadItem`; its AI job creates the existing canonical `InventoryItem`/`ListingDraft` transactionally and links back exactly once.
- AI concurrency is account-bounded. A failed item does not fail siblings. Retry increments `processingVersion` and never creates a second inventory item.
- Bulk edit accepts a strict field whitelist and optimistic version. It returns per-item validation results. Never mass-apply authenticity confirmation or hidden-flaw claims.
- Bulk comps dedupe identical strong identity keys and reserve provider budget atomically. Generic/weak items skip paid providers and ask for manual price.
- Preflight returns per-item/per-channel `ready`, `needs_details`, `skipped`, `blocked`, with no external write. Execution calls the existing single-item handler and persists one job per item/channel under `bulkRunId`.
- Progress comes from polling/SSE over durable state, not client-maintained counts. Refreshing or reopening reconstructs exact state.
- Retry only `RETRY_WAIT`/retryable `FAILED`; permanent validation returns to review. Cancel prevents new claims but cannot undo a confirmed external publish; show those items explicitly.
- Caps: Free default 10, Pro 50, Kingpin 250 per intake/publish action; keep a separate high transport ceiling. Check cap at batch create, process, preflight, and execute.
- Admin sees counts, age, stuck stage, sanitized error code, spend, actor, and safe retry/cancel. Admin cannot force publish around readiness or kill switches.

Tests: 100-photo upload split into 10 items; duplicate completion; foreign batch path; refresh/resume; AI partial failure; retry idempotency; regroup before processing; regroup rejection after canonical item creation; plan downgrade mid-batch; cancel race; concurrent publish click; partial marketplace failure; stale job reaper; exact progress aggregates.

## 9. Price comps system

### Evidence policy

- `sold` evidence outranks active listings; StockX bid/ask is a distinct market signal; active asks never prove value.
- Normalize item price, shipping, currency, condition, size, sale date, source ID, URL, and identity. Deduplicate the same marketplace result before scoring.
- Reject lots/bundles, replicas/customs/damaged items unless the target matches; brand/model/style mismatch; incompatible size/condition; stale currency; implausible price.
- Outliers: median/MAD when at least 5 accepted comps; IQR as a secondary check at 8+; never remove the only evidence just to create a recommendation.

### Confidence and refusal

- **High:** at least 5 strong sold comps, identity exact, median age <=180 days, normalized dispersion <=0.35, no material size/condition conflict.
- **Medium:** at least 3 accepted sold comps with 2 strong, or strong sold data plus a corroborating bid/ask signal; dispersion <=0.55.
- **Low:** 1–2 accepted results, possible matches, old evidence, or conflicting ranges. Show range and evidence, not a confident recommendation.
- **Refuse recommendation:** no reliable sold evidence; generic/unbranded identity; mixed lots; fewer than 3 accepted sold comps for an automatic price; max/min >4x after filtering; ambiguous currency; suspected counterfeit; provider results disagree with identity. Say “Price manually” and keep manual comps available.

### Free and paid behavior

- Free: unlimited manual comps, cached/connected official signals where terms permit, 10 refresh actions/month, at most 2 paid-provider reservations/month, strong-identity gate. This is useful but caps worst-case acquisition cost.
- Pro: 100 refresh actions, provider spend sub-budget and cooldown, batch comp queue.
- Kingpin: 750 refresh actions, larger sub-budget and priority queue; still no unlimited provider spend.
- Cache by normalized identity only when provider terms allow redistribution; never cache seller tokens or account-private data across accounts.
- Global/provider/account daily budget, account monthly budget, per-item cooldown, concurrency cap, timeout, circuit breaker, and append-only reservation ledger. Provider unavailable degrades to cached/manual/other source.
- The current advisory-lock reservation is the right pattern; move authority from user to account and record actual cost when available.

Tests: generic black shirt makes zero paid calls; exact style/size; wrong brand; mixed bundle; damaged comp; currency; duplicate URLs; MAD/IQR; one extreme outlier; sparse evidence refusal; StockX bid/ask not sold; provider 429/timeout; reservation concurrency; completion ledger failure; cache expiry/terms; free budget exhaustion; no passive fetch.

## 10. Inventory sync and double-sell prevention

Keep the existing atomic `markItemSold` design: optimistic item version, quantity zero, sold source, `sale_confirmed` event, and other-channel delist jobs commit in one transaction. Harden the surrounding system:

1. Ingest only verified webhook events, official order polling, trusted signed email ingestion, or an authenticated manual action.
2. Normalize every signal to `{accountId, marketplace, environment, externalEventId, externalOrderId, externalListingId, eventTime, state, confidence}`.
3. Deduplicate before the sale decision. Require an exact listing/SKU mapping and one owner; ambiguous matches create a task.
4. Lock/update the canonical item. The first valid sale wins. Same-source replay is a no-op; a different source creates a conflict without overwriting evidence.
5. Transactionally insert one delist job per other live listing using `delist:itemId:marketplaceListingId:soldVersion`.
6. Worker re-reads the item/listing/account and capability before each external call. A listing created after the sale is blocked by the publish handler’s current-state check.
7. Retry classification: validation/auth/manual/policy errors -> `NEEDS_REVIEW`; 408/429/5xx/network -> `RETRY_WAIT`; remote success -> `SUCCEEDED`; unknown timeout -> reconcile before retry.
8. Backoff with jitter: 1m, 5m, 30m, 2h, 8h; honor `Retry-After`; maximum attempts per operation. A reaper requeues expired leases, not fresh workers.
9. `needs_review` is terminal for automation until a seller/admin action explicitly requeues it. Correct the current misleading comment/behavior.
10. Reconciliation schedule: high-frequency for `LISTING/DELISTING/UNKNOWN`, slower for `LISTED`; durable cursor per account/channel; eBay Fulfillment and StockX orders/history first.
11. A failed delist creates an urgent notification and one deduped review task. Escalate unread urgent tasks after a configured interval.
12. Every signal, state transition, external attempt, retry, terminal decision, manual resolution, and admin action writes sanitized audit data.

Dangerous current gaps to close: eBay `detect_status` is `NOT_IMPLEMENTED`; `mark_sold`, `update_inventory_quantity`, `update_price`, and `sync_order` job executors are `NOT_IMPLEMENTED`; normal status-sync failures go directly to `failed`; current `needs_review` rows are not claimed.

Race tests: two marketplaces sell simultaneously; publish vs sold; delist vs relist; webhook vs poll replay; worker lease expiry during remote success; timeout then reconcile; item deletion during lock; two account members act; duplicate external IDs; retry exhaustion creates exactly one task.

## 11. Billing and limits

### Effective capability model

Replace separate plan, alpha allowlist, environment flag, connection, and adapter checks with one server-only resolver:

```text
effectiveCapability = planIncludesAction
                   AND productRolloutAllowsAccount
                   AND globalKillSwitchOn
                   AND adapterImplemented
                   AND marketplacePartnerAccessVerified
                   AND connectionReady
                   AND itemReady
```

Return structured reasons, not only booleans. APIs enforce the same resolver; client capability data is display-only. Admin testing may bypass plan/rollout limits but never global kill switches, missing adapter, production environment separation, ownership, or marketplace readiness.

### Proposed paid-beta catalog

| Limit | Free | Pro ($20/mo) | Kingpin ($119/mo) |
|---|---:|---:|---:|
| AI listings/month | 10 | 125 | 1,000 |
| Publish units/month | 10 | 125 | 1,000 |
| Comp refresh actions/month | 10 | 100 | 750 |
| Paid-provider reservations/month | 2 | 25 | 150, also spend-capped |
| Marketplace connections | 1 | 3 | 5 |
| Bulk items/action | **10** | 50 | 250 |
| Team seats | 1 | 1 | 5 |

A publish unit is one item written to one marketplace. Failed preflight and no-op duplicates consume zero; a remote write that was accepted consumes one even if later reconciliation is required. Manual comps and copy-ready exports do not consume provider or autopublish units.

### Atomic metering

- `reserveUsage(accountId, metric, units, idempotencyKey)` runs in a transaction/advisory lock, reads settled+reserved totals, and inserts `UsageMeterEvent(RESERVED)` only if capacity remains.
- Work settles the reservation on accepted external/AI success; safe pre-call failure releases it. A sweeper expires abandoned reservations only after checking the domain job outcome.
- `UsageCounter` becomes a cache/rollup, not authority. Rebuild it from events.
- Batch reserves the whole maximum or per-item units before dispatch; partial results settle/release individually.

### Stripe safety

- Keep raw-body signature verification and `StripeEvent` dedupe. Add event-created ordering so an old replay cannot downgrade a newer subscription.
- Price ID is server-mapped to one plan. Unknown price/product fails closed and creates an operator alert.
- Checkout/Portal remain owner/admin-only, with account ID in signed metadata and verified against the Stripe customer.
- `past_due` uses a short documented grace state; destructive downgrade never deletes listings/connections. It blocks new over-limit work and preserves read/export/delist access.
- Cancellation retains paid capability through the paid-through period. Webhook lag shows “Plan update pending” and supports idempotent reconciliation.

Tests: 20 concurrent final free credits; duplicate request key; batch partial settlement; counter rebuild; unknown Stripe price; forged signature; duplicate/out-of-order webhook; customer/account mismatch; member checkout denial; cancel-at-period-end; downgrade below connections; admin cannot bypass kill switch.

## 12. Security review

| Risk | Exact mitigation | Required test |
|---|---|---|
| OAuth CSRF/replay | signed state + user/account/environment + one-time hashed nonce + 10m TTL + HttpOnly Secure SameSite cookie; consume atomically | callback replay and cross-account callback denied |
| Token theft | AES-256-GCM, per-marketplace key version, KMS/envelope rotation, ciphertext never returned/logged | wrong/old key and rotation path |
| Secret leakage | env/server only; structured redaction; no raw provider bodies, URLs with tokens, Prisma errors, or stack traces | seeded token patterns absent from logs/responses |
| Webhook forgery | raw body signature/timestamp, provider key rotation/cache, replay unique key, body limit | invalid signature, stale timestamp, duplicate event |
| SSR auth confusion | verified Supabase `getUser`; cookie/bearer identity must match; never accept user/account from body | mismatched contexts -> 403 |
| IDOR/tenant leak | resolve active account server-side; scope every query by account relation; worker revalidates ownership | user A cannot read/write/enqueue B |
| Weak RLS assumption | keep deny-all browser RLS; verify runtime role; account policies only before direct data queries | anon/auth DB roles see zero; runtime still works |
| Admin exposure | server layout + API gate; move durable roles to DB with owner-controlled assignment; 404 for non-admin | page and API independently denied |
| Shared worker secret replay | replace/augment with scheduler identity or timestamped HMAC; rotate; rate limit; body hash | stale/replayed signature denied |
| Email spoofing | verify inbound provider webhook/signature before trusted ingest; destination alias maps account; email alone never high-confidence unless exact mapping | forged From cannot mark sold |
| Provider budget abuse | atomic reservations, account limits, identity gate, cooldown, circuit breaker, rate limits | concurrency cannot exceed budget |
| Marketplace write abuse | explicit confirmation token bound to payload hash, short TTL, account, item, channel, environment; idempotency | mutate after preview requires reconfirmation |
| CSRF | SameSite cookies plus Origin/Host validation for cookie-auth state-changing routes; bearer APIs remain token-auth | cross-origin POST rejected |
| Upload abuse | signed scoped keys, MIME sniff, size/pixel limits, checksum, malware scan/quarantine, EXIF strip in derivatives | polyglot/zip bomb/foreign path denied |
| SSRF | fetch only adapter-controlled hosts; validate image URLs/storage origin; block private IP redirects | private/metadata URL denied |
| Mass assignment | strict Zod and field whitelist; server sets owner/status/cost | extra owner/status fields rejected |
| Race/TOCTOU | transaction locks/version checks and re-read before external call | sold during publish never writes live listing |
| Log injection/PII | structured fields, newline stripping, allowlisted provider codes, body minimization/retention | malicious provider text stays inert/redacted |
| Sandbox/prod bleed | environment in config, DB uniques, idempotency, SKU, connection, and UI; no fallback credentials | sandbox token cannot call production |
| Dependency/supply chain | lockfile, Dependabot, CI audit, minimal worker image, no runtime package install | CI lockfile and high-severity gate |

Additional controls: per-route/account rate limits; request IDs; CSP; secure headers; no secrets in client bundles; webhook payload retention policy; audit-log immutability; database backups and restore drill; least-privilege storage buckets; account deletion/export runbook.

## 13. UX copy and seller-facing language

| State | Copy |
|---|---|
| Listing created | **Listing created.** Review the highlighted details, then choose where to list it. |
| AI needs review | **A few details need your call.** Confirm the highlighted fields before this listing can go live. |
| High comp confidence | **Strong price signal.** Based on {n} closely matched sold listings. |
| Medium comp confidence | **Useful price range.** The matches are solid, but size, condition, or recency varies. |
| Low comp confidence | **Price manually.** We did not find enough close sold matches to recommend a reliable price. |
| eBay not ready | **Finish eBay setup.** Add {missing} in Marketplace settings, then run the check again. |
| StockX match needed | **Choose the exact StockX product and size.** Sello will not list a guessed catalog match. |
| Publish failed, retryable | **eBay did not confirm the listing.** We’re checking the result before trying again. No duplicate will be created. |
| Publish failed, permanent | **This listing was not published.** Fix {field/reason}, then try again. |
| Delist failed | **Remove this listing now.** We could not end it on {marketplace}. Open the listing and mark it removed to prevent a double sale. |
| Sold detected | **Sold on {marketplace}.** Quantity is now 0 and Sello is removing the other live listings. |
| Bulk processing | **Building {n} listings.** {ready} ready · {review} need review · {failed} could not finish. You can leave this page. |
| Plan limit reached | **You’ve used this month’s {feature} allowance.** Upgrade for more, or continue on {renewalDate}. Existing listings stay available. |
| Provider unavailable | **Fresh comps are temporarily unavailable.** Your listing is safe—use saved or manual comps, or try again later. |
| Manual action required | **Your action is required.** {specific action}. Sello cannot complete this step for you. |
| Partner access required | **{Marketplace} partner access required.** This feature is included in your plan, but {Marketplace} must approve the connection first. |
| Quantity | **Quantity: 1** (visible in every live preflight) |

Avoid “autopublish” when the seller still confirms each write; use “live publish” or “publish units.” Avoid “sync active” unless a real status/order worker is scheduled and healthy.

## 14. Admin/operator dashboard

All pages are server-gated and account/support actions create `AuditLog` entries.

| Page | Shows | Safe actions |
|---|---|---|
| Provider usage | calls, reserved/actual spend, acceptance, errors, budgets | disable provider, lower cap, release only proven-stale reservation |
| Failed jobs | type, account, age, attempts, safe code, next run | retry retryable, cancel queued, create task; never force success |
| Marketplace health | OAuth/config state by name only, latency, 429/5xx, reconciliation lag | global/account disable, request reconnect, run read-only probe |
| Accounts | plan, members, usage, connections, risk flags | suspend new writes, revoke member, support-view sanitized state |
| Billing | Stripe IDs masked, subscription state, event lag | reconcile from Stripe read, resend portal link; no manual paid grant without audit |
| Bulk batches | stage counts, stuck age, AI/provider spend | cancel unclaimed, retry failed item, requeue stale lease |
| Feedback | existing triage | status/notes only |
| Audit logs | immutable actor/action/target/correlation | export filtered view; no edit/delete |
| Notifications/tasks | urgent unread, overdue, dedupe | resend notification, assign/resolve with reason |
| Kill switches | effective global and provider/channel states | two-step disable/enable, reason, expiry, actor; enabling cannot bypass missing config |

Admin must not see tokens, raw email bodies, full addresses, provider request/response payloads, or unrestricted impersonation. If support impersonation is ever added, require owner consent, short TTL, visible banner, read-only default, and full audit.

## 15. Testing strategy

### Layers

- Unit: state machines, mappings, scoring, confidence, redaction, entitlements, retry classification, copy.
- Integration: Prisma transactions/advisory locks/unique indexes/RLS in disposable Postgres.
- Route: auth/account scope, strict Zod, status codes, idempotency, no raw errors.
- Worker: claim/lease/backoff/reaper, timeout reconciliation, terminal/manual action.
- Adapter contracts: recorded official schema fixtures plus staging/sandbox read-only probes; no live writes in CI.
- Billing: signed webhook fixtures, ordering, replay, atomic usage reservations.
- Security: IDOR, OAuth replay, CSRF, SSRF, upload polyglot, webhook forgery, log redaction.
- Race: concurrent quota, publish/sold, two sale signals, duplicate webhook, two workers.
- Bulk: refresh/resume, partial failure, cancel, retry, plan downgrade, progress aggregation.
- E2E: signed-in single item; 10-item bulk review; mocked/recorded eBay publish and delist state transitions with zero outbound marketplace calls; copy-ready channel; plan limit; sold -> delist task.
- Smoke: public/auth/admin routes, protected APIs, disabled live switches, no 5xx/log leak, worker lag, migration status.

Example test names:

```text
effective-capability.test.ts > paid plan cannot bypass missing adapter or partner access
usage-reservation.integration.test.ts > 20 concurrent requests consume one remaining unit once
bulk-upload.integration.test.ts > retry reuses inventory item and AI idempotency key
bulk-upload-route.test.ts > foreign signed object path is rejected
sync-worker.integration.test.ts > 429 schedules retry_wait with Retry-After
sync-worker.integration.test.ts > expired lease requeues without duplicate remote call
ebay-order-sync.test.ts > repeated order line marks sold once and queues each delist once
inventory-race.integration.test.ts > publish loses to sold transaction before external call
stockx-operation.test.ts > timeout reconciles operation before replay
stockx-comps.test.ts > bid ask rows never produce sold-comp confidence
depop-capability.test.ts > no partner approval keeps publish disabled
oauth-state.integration.test.ts > consumed state cannot be replayed
webhook-security.test.ts > invalid and stale signatures perform zero DB writes
admin-idor.test.ts > admin support endpoint never returns token ciphertext
pricing-copy.test.ts > bulk default and effective access match plan catalog
```

Required gate for every stage:

```bash
npm run lint
npx tsc --noEmit --pretty false
npx prisma validate
npm test
npm run build
git diff --check
```

Migration stages also run `npx prisma migrate status` against the intended preview database and migration-specific Vitest files. Standard validation performs no deployment, environment mutation, paid-provider call, marketplace publish, or delist. Any live or sandbox write smoke is a separate future task requiring explicit owner approval and a reversible runbook.

## 16. Implementation order

Each stage is a sequence of small PRs; do not put all work in one branch.

### Stage 1 — paid-beta blockers

**Likely files/modules:** `src/lib/marketplace/registry*`, `adapter*`, `auth/feature-access*`, `billing/*`, Prisma schema/migrations, new `bulk-intake/*`, bulk pages/routes, `inventory-sync/jobs/worker*`, eBay OAuth/order sync, tasks/notifications, admin jobs/batches.

**Implement in order:**

1. Protect the restored green baseline; correct TikTok/Depop capability truth and queue eligibility.
2. Add effective capability resolver and atomic `UsageMeterEvent`; make pricing/capability APIs consume it.
3. Add bulk batch/item/photo persistence, signed upload finalization, AI worker, durable review page, default limit 10.
4. Fix retry/backoff/lease semantics and task UI; implement eBay Fulfillment order reconciliation and scope upgrade.
5. Add immutable cross-domain audit and minimum operator job/batch/task views.

**Do not touch:** working eBay payload/production gate, StockX live endpoints, token formats without rotation migration, production env, Stripe prices, or unsupported marketplace automation.

**Merge criteria:** full gate green; disposable-DB concurrency tests; 10-item E2E; recorded eBay contract/order fixtures with zero external writes; no P0; CodeRabbit/external review resolved; migration rollback documented.

**Rollback:** feature flags for new bulk intake/order sync/effective capability; additive migrations remain; UI routes hidden; old single-item/publish paths continue. Never roll back a schema by deleting production rows.

### Stage 2 — marketplace hardening

**Files:** eBay and StockX adapters/routes/workers, marketplace settings/capabilities, contract fixtures.

**Implement:** eBay remote-unknown reconciliation/notification path; StockX operation polling/order sync/condition eligibility; token key versioning; connection health.

**Do not touch:** Depop/Vinted/TikTok writes without approval; assisted channels.

**Merge criteria:** adapter contract suites, sandbox/staging read-only probes, controlled one-item runbook approved, kill switches off by default.

**Rollback:** disable channel sub-switch; stop new jobs; reconcile in-flight operations; preserve remote IDs and manual tasks.

### Stage 3 — bulk scale

**Files:** bulk services/workers/UI, queue/outbox, comp dedupe/cache, observability.

**Implement:** 50/250-item performance, bounded concurrency, priority, SSE, backpressure, batch comp identity dedupe, abandoned upload cleanup, load tests.

**Do not touch:** plan prices or marketplace contract scope.

**Merge criteria:** load test at 2x Kingpin batch; no duplicate items/writes; queue lag SLO; provider budget holds under concurrency.

**Rollback:** lower transport/concurrency caps; disable SSE/AI grouping; keep polling/manual grouping.

### Stage 4 — advanced automation

**Files:** new approved partner adapters for Depop, Vinted, TikTok; webhook/order services.

**Implement:** only one channel at a time after written access and terms review; capability probe, OAuth/signing, product validation, publish/update/delist, orders/webhooks, sandbox/dev mode.

**Do not touch:** Grailed/Poshmark/Facebook private automation.

**Merge criteria:** verified partner test access, partner contract checklist, adapter contract suite, account-isolation and replay tests. A controlled write smoke and cleanup is separate from validation and requires explicit owner approval.

**Rollback:** channel kill switch; stop new writes; retain read/reconciliation; create manual tasks for unresolved live listings.

### Stage 5 — growth/admin polish

**Files:** admin pages, analytics, notifications/email, pricing/billing UI.

**Implement:** SLO dashboards, provider unit economics, activation funnel, overdue-task escalation, clearer pricing comparison, support runbooks.

**Do not touch:** safety gates for conversion gains.

**Merge criteria:** no capability-copy mismatch; analytics excludes secrets/PII; accessibility and responsive checks; support drill.

**Rollback:** analytics/email feature flags; core listing/sync remains independent.

## 17. Concrete developer prompt

```text
You are the principal engineer implementing Sello paid-beta readiness in
/Users/jheller/dev/resale-crosslister-clean.

Read AGENTS.md and HANDOFF.md first. Confirm the canonical git top-level, branch,
HEAD, worktrees, and dirty state. Work on a dedicated feature/* worktree; do not
switch or overwrite a dirty checkout. Read relevant Next.js 16 docs under
node_modules/next/dist/docs before changing framework APIs.

Treat docs/PAID_BETA_IMPLEMENTATION_PLAN_2026-07-09.md as the product/architecture
contract, but inspect the current repo before coding because implementation may
have moved. Build only missing pieces. Preserve working eBay and StockX behavior,
the explicit live-action confirmations, token encryption, account scoping,
provider budget reservation, production kill switches, and existing migrations.

Start with Stage 1 only and split it into small PR-sized checkpoints:
1) restore the green baseline and correct marketplace capability truth;
2) effective capability + atomic usage reservations;
3) durable bulk upload batch/item/photo + 10-item review flow;
4) production retry/lease semantics + eBay order/sold reconciliation;
5) audit log + minimum task/operator surfaces.
Run focused red tests before each behavior change, implement narrowly, then run
the full gate before moving to the next checkpoint. Do not proceed past a failed
major gate without diagnosing it.

Rules:
- Say “listing” consistently; avoid weak draft-oriented product language.
- Never fake publishing, delisting, sync, sold comps, or partner access.
- Every marketplace write is idempotent and bound to account, item, environment,
  payload hash, explicit user confirmation, and a server kill switch.
- Every paid action uses an atomic account-scoped usage reservation and a
  ProviderCallLedger entry when a paid provider is involved.
- Every job is durable and ends in SUCCEEDED, retryable RETRY_WAIT, FAILED, or
  NEEDS_REVIEW with a typed reason. Unknown remote outcomes reconcile before retry.
- Every user-facing failure has a next step or a ReviewTask.
- Every automated sold/delist decision writes InventoryEvent and AuditLog rows.
- Enforce every paid capability server-side. Client flags are display only.
- Account scope is the tenant boundary; never trust user/account IDs from input.
- Validate all external input with strict Zod. Sanitize provider errors.
- Never print/log/commit secrets, token ciphertext, raw provider payloads, Prisma
  errors, stack traces, email bodies, or environment values. Report env by name/state.
- Do not use private APIs, scraping, browser bots, CAPTCHA bypasses, or credentials.
- Do not deploy, push main, change production env, call a paid provider, publish,
  delist, or run a live marketplace smoke without explicit owner approval.
- The standard validation gate must make zero paid-provider or marketplace write
  calls. Any approved write smoke is a separate future task, never part of CI.

Required implementation details:
- Additive Prisma migrations with migration contract tests and rollback notes.
- Bulk states and transitions exactly defined in the plan; refresh/resume and
  partial failures must work.
- Effective capability explains plan, rollout, adapter, partner access, connection,
  item readiness, and kill-switch denial separately.
- UsageMeterEvent reservations are concurrency-tested and idempotent.
- eBay Fulfillment/order events dedupe and call the existing atomic markItemSold;
  every other live listing gets one delist job.
- TikTok remains non-native/queue-ineligible until a real adapter exists. Depop is
  partner-gated, not described as nonexistent. Grailed/Poshmark/Facebook stay assisted.

Run and report:
npm run lint
npx tsc --noEmit --pretty false
npx prisma validate
npm test
npm run build
git diff --check
plus focused migration/concurrency/E2E tests.

Finish with: files changed; migrations; tests and exact results; security review;
remaining blockers; flags/env names only; rollback; and explicit confirmation that
there was no deployment or live marketplace/provider action. Update HANDOFF.md.
```

## 18. Skeptical review: attack and revision

### 20 production failure modes

1. Redis accepts a job but the DB transaction rolls back, creating work with no domain row.
2. DB commits but Redis enqueue fails, stranding work forever.
3. Worker times out after a marketplace accepted the write and retries into a duplicate.
4. A stale worker finishes after its lease was reassigned and overwrites the newer result.
5. `needs_review` is treated as retryable but no claimant ever selects it.
6. eBay scope upgrade silently invalidates existing connections and sold sync never runs.
7. Fulfillment cursor advances before all order lines commit, permanently skipping a sale.
8. A provider schema change parses an empty success and lowers prices to nonsense.
9. Provider reservations remain `attempted` after a crash and exhaust the daily budget.
10. Batch aggregate status disagrees with child items after partial transaction failure.
11. Signed uploads complete but object storage event/finalization is lost.
12. AI creates an inventory item, response fails, and retry creates another item.
13. Stripe sends an older event after a newer one and downgrades the account incorrectly.
14. Plan downgrade makes existing queued work exceed limits midway through execution.
15. A global channel switch changes while workers already hold claims.
16. Token refresh succeeds remotely but encrypted persistence fails, causing repeated refreshes.
17. Notification delivery retries send repeated urgent emails.
18. Reconciliation polling hits rate limits across all accounts and falls permanently behind.
19. Migration enables constraints before backfill, breaking production writes.
20. “Full native” registry flags expose controls before a real adapter is deployed.

### 20 seller edge cases

1. Ten items share visually identical photos and AI groups them incorrectly.
2. One item has front/back/tag photos uploaded across two browser sessions.
3. Seller closes the tab during upload, AI, preflight, or publish.
4. Seller removes a photo after AI extraction but before approval.
5. Two team members edit the same listing and bulk fields concurrently.
6. An item has no brand, no tag, and generic title but the seller still needs a listing.
7. Size is region-specific (`US M 10`, `EU 44`, `One Size`) and StockX variant differs.
8. One photo contains two products; other photos contain only one.
9. A bundle/lot is intentionally one listing and outlier logic mistakes it for noise.
10. Seller changes account/plan while a batch is open.
11. Seller connects the same marketplace under another account/workspace.
12. A listing sells offline while publish jobs are queued.
13. Buyer cancellation arrives after Sello marked sold and delisted other channels.
14. Sale email lacks listing ID and matches two similar items.
15. Marketplace listing was edited manually after Sello published it.
16. Seller manually deletes the remote listing before Sello delists it.
17. Currency differs between account, marketplace, and comp provider.
18. Marketplace rejects a word/photo only after initial review/audit.
19. Seller cancels a batch after some channels are already live.
20. Seller hits monthly quota exactly while two requests complete together.

### 20 security or abuse risks

1. OAuth callback replay links an attacker-controlled marketplace account.
2. Cross-workspace connection ID is used in a publish request.
3. Confirmation token is replayed after the listing price/photos change.
4. Webhook event ID collision is used across environments.
5. Forged sale email triggers delists.
6. Shared worker secret is replayed from captured traffic.
7. Signed upload URL writes to another account’s predictable path.
8. Image decompression bomb exhausts worker memory.
9. External image URL causes SSRF to cloud metadata.
10. Provider error includes bearer token and is logged.
11. Admin export leaks token ciphertext or buyer PII.
12. Usage check/increment race grants free paid work.
13. Unlimited skipped ledger rows become a storage/DoS vector.
14. Batch request fans out to a million item IDs despite UI caps.
15. Stripe customer ID from one account is attached to another.
16. Member role is changed mid-request after authorization.
17. Marketplace `externalUrl` contains a phishing or javascript-like link.
18. Audit payload stores raw webhook/email data indefinitely.
19. Weak environment defaults route sandbox intent to production.
20. Dependency compromise exfiltrates server environment variables.

### 20 UX confusion risks

1. “Autopublish” implies no confirmation while Sello requires confirmation.
2. “10 comp refreshes” does not say whether fresh paid data is included.
3. Paid plan appears to guarantee Depop/Vinted partner approval.
4. “Sync active” appears although only StockX status sync exists.
5. A batch says complete when some items were merely skipped.
6. `FAILED`, `NEEDS_REVIEW`, and `ACTION_REQUIRED` look interchangeable.
7. A timeout message makes sellers click Publish again.
8. Bid/ask guidance appears beside sold comps without a label.
9. Manual copy-ready channel shows a disabled Publish button.
10. Quantity is hidden, increasing fear of multi-quantity listings.
11. Seller cannot tell which photo or field caused marketplace rejection.
12. “Plan limit reached” looks like existing listings will be removed.
13. Marketplace connection cap blocks StockX but does not explain replacing a connection.
14. OAuth success returns to settings without showing remaining readiness steps.
15. Urgent delist task is buried with low-priority AI review.
16. Bulk progress resets visually after refresh.
17. Retry appears to rerun successful items and risk duplicates.
18. “Sold detected” does not distinguish confirmed vs possible sale.
19. Admin kill switch error is shown as a seller setup problem.
20. Free/Pro/Kingpin copy differs between landing, pricing, billing, and API.

### 20 marketplace/API/policy break risks

1. eBay adds a new required aspect after a listing was approved.
2. eBay business policy/location is deleted or disabled remotely.
3. eBay notification topic/key verification changes.
4. eBay order states or pagination semantics change.
5. StockX changes an async operation endpoint/response field.
6. StockX rate limits batch items rather than HTTP calls.
7. StockX condition/inventory eligibility changes per seller/region.
8. StockX bid/ask semantics change or include seller’s own ask differently.
9. Depop partner approval is denied or contract limits multi-seller OAuth.
10. Depop product fields/taxonomy/managed shipping become region-specific.
11. Vinted reduces slot allocation or rejects a whole batch atomically.
12. Vinted allowlist/dev-mode terms change.
13. TikTok Shop product review becomes asynchronous with new rejection states.
14. TikTok category attributes, certifications, or warehouses vary by region.
15. TikTok webhook delivery is delayed or unordered.
16. Grailed tightens enforcement against assisted/browser behaviors.
17. Poshmark treats a proposed helper as prohibited automation.
18. Facebook Marketplace never provides a general apparel publishing partner path.
19. Provider terms prohibit cross-account comp caching/display.
20. API version deprecation happens before Sello updates its contract fixtures.

### 20 highest-value tests

1. DB commit with Redis enqueue failure is recovered by outbox polling.
2. Remote publish success plus local timeout reconciles without a second create.
3. Expired worker lease cannot overwrite the winning lease result.
4. Twenty concurrent requests with one unit left settle one reservation.
5. AI retry creates exactly one inventory item per bulk item.
6. Batch with 7 ready/2 review/1 failed derives the exact aggregate state.
7. eBay order cursor crash mid-page reprocesses safely and skips nothing.
8. Two marketplace sale events produce one sold state and one conflict task.
9. Publish queued before offline sale makes zero external call.
10. Delist 429 honors retry-after, then succeeds once.
11. OAuth state replay/cross-account/environment mismatch performs zero token exchange.
12. Forged/stale webhook and forged email perform zero sale mutation.
13. User A cannot access B’s batch, photos, jobs, connection, item, or audit rows.
14. Confirmation payload hash mismatch forces a new preview/confirmation.
15. Old Stripe event cannot overwrite newer plan state.
16. Plan downgrade preserves live listings but blocks new over-limit work.
17. Generic item makes zero paid calls and returns “Price manually.”
18. StockX bid/ask evidence cannot produce high sold-comp confidence.
19. TikTok stub/disabled partner channel is absent from publish queue eligibility.
20. Secret-pattern fixture never appears in API, persisted seller error, admin page, or logs.

### Revised plan after the attack

The attack changes the earlier plan in these concrete ways:

1. **Transactional outbox is mandatory in Stage 1**, not optional architecture polish. DB is durable truth; Redis is only a wake-up mechanism.
2. **Every worker uses a fencing token/lease version.** Completion updates require the current lease token, preventing stale-worker writes.
3. **Unknown remote outcomes are a distinct state** (`RECONCILING` or retry class), and create/publish is never replayed until a read proves absence.
4. **Order cursors advance in the same transaction as event dedupe/domain writes**, or use overlap windows so crashes replay safely.
5. **Usage reservations, provider reservations, and bulk-item idempotency ship before bulk concurrency.** Counters are derived, not authoritative.
6. **Queued work rechecks plan and kill switches at claim and immediately before external mutation.** Downgrades release unstarted reservations; accepted remote writes settle.
7. **Batch state is derived from child rows**, with invariant tests; clients never write aggregate counts/status directly.
8. **Upload finalization is a server reconciliation job** based on object existence/checksum; abandoned objects expire by lifecycle policy.
9. **Notification delivery gets a dedupe key and outbox status** so retries do not spam.
10. **Provider/API contract fixtures and version alarms become a release gate.** Schema drift produces a typed provider-unavailable state, never empty success.
11. **Marketplace access is modeled separately from plan inclusion.** Pricing and in-product copy show both; TikTok remains downgraded and Depop/Vinted remain partner-gated.
12. **Manual channels get actions, not disabled controls:** Copy details, Download photos, Open marketplace, Attach listing URL, Mark removed.
13. **Urgency is first-class:** possible sale vs confirmed sale are distinct; manual delist tasks outrank AI review and have escalation.
14. **Cancellation is compensating, not magical.** It stops unclaimed work and clearly lists already-live external listings requiring action.
15. **No cross-account comp cache until provider terms explicitly permit it.** Cache scope defaults to account/provider.
16. **A capability/copy contract test spans plan catalog, `/pricing`, billing, registry, and `/api/capabilities`** to prevent divergent promises.
17. **Stage 1 is not mergeable as one giant PR.** The five checkpoints listed above each require focused + full gates and review before the next.
18. **Operational readiness is measured:** queue age, reconciliation lag, delist success latency, manual-task age, provider spend, and webhook failures have alert thresholds before paid beta.

Final paid-beta SLO targets: 99% of accepted jobs reach a clear terminal/retry state; zero duplicate remote listings in test and controlled smoke; confirmed sold event queues all other-channel delists within 60 seconds; 95% of adapter-backed delists succeed or become visible tasks within 5 minutes; no quota/provider budget overshoot under concurrency; no unresolved P0 security finding.
