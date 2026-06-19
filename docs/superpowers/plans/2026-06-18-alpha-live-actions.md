# Alpha Live Marketplace Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real eBay publish, uncapped seller-facing bulk publish, safe eBay delist, and paid sold comps for feature-allowlisted beta accounts, with honest unavailable states for everyone else.

**Architecture:** A server-only entitlement module maps three independent email allowlists to stable capabilities and denial codes. Existing single-item publish, preflight, delist, and paid-provider services stay canonical; new routes enforce entitlement before side effects, and bulk orchestration reuses those services with deduplication, internal chunks, low concurrency, idempotency, and per-item results. UI capabilities come from an authenticated server endpoint and are never trusted for authorization.

**Tech Stack:** Next.js 16 App Router route handlers, React 19, TypeScript 6 strict mode, Zod 4, Prisma 7/Postgres, Supabase Auth, Vitest, Vercel.

---

## File Structure

New focused units:

- `src/lib/auth/feature-access.ts`: parse beta allowlists, calculate safe seller capabilities, and throw stable server-side entitlement failures.
- `src/app/api/capabilities/route.ts`: authenticated current-user capability endpoint.
- `src/components/providers/feature-access-provider.tsx`: one authenticated capability fetch shared by app UI.
- `src/lib/marketplace/bulk-publish.ts`: bulk request configuration, preflight, chunk/concurrency executor, and safe per-item result mapping.
- `src/lib/marketplace/bulk-publish-request.ts`: Zod schemas for preflight and confirmed execution.
- `src/app/api/listings/publish/bulk/preflight/route.ts`: seller-scoped, non-publishing bulk preview.
- `src/app/api/listings/publish/bulk/route.ts`: allowlisted, confirmed bulk execution.
- `src/components/app/bulk-publish-modal.tsx`: merged preflight and per-item result UI.
- `src/lib/view/inventory-actions.ts`: pure inventory-search and safe-delete/action eligibility helpers.
- `src/app/api/admin/marketplace-operations/route.ts`: admin-only access and marketplace operation audit data.
- `src/app/(app)/admin/marketplace-operations/page.tsx`: read-only operational dashboard.
- `docs/ALPHA_LIVE_ACTIONS.md`: operator configuration, rollout, smoke, and rollback runbook.

Existing units modified in place:

- publish and delist routes/handlers for entitlement and bulk correlation;
- comp refresh, auto-discovery, fetch, and seller copy for paid entitlement and identity enforcement;
- app layout/API client for capabilities;
- inventory/editor/publish/pricing/marketplace UI for real actions and honest unavailable states;
- listing delete route for live-artifact protection;
- admin provider view/navigation for operations visibility;
- `.env.example`, `README.md`, and `HANDOFF.md` for operator state.

### Task 1: Add independent server-side feature entitlements

**Files:**
- Create: `src/lib/auth/feature-access.ts`
- Create: `src/lib/auth/feature-access.test.ts`
- Create: `src/app/api/capabilities/route.ts`
- Create: `src/app/api/capabilities/route.test.ts`
- Create: `src/components/providers/feature-access-provider.tsx`
- Create: `src/components/providers/feature-access-provider.test.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/lib/api/client.ts`

- [ ] **Step 1: Write failing entitlement tests**

Cover case-insensitive comma parsing, whitespace/duplicates, no `ADMIN_EMAILS` fallback, missing email, missing env, independent grants, stable denial codes, and safe public copy. Define the public contract:

```ts
export type FeatureAccess = {
  liveEbayPublish: boolean;
  ebayDelist: boolean;
  paidComps: boolean;
};

expect(featureAccessForUser(
  { email: "owner@example.com" },
  {
    ADMIN_EMAILS: "owner@example.com",
    LIVE_EBAY_PUBLISH_EMAILS: "",
    EBAY_DELIST_EMAILS: "owner@example.com",
    PAID_COMPS_EMAILS: "beta@example.com, OWNER@example.com",
  },
)).toEqual({ liveEbayPublish: false, ebayDelist: true, paidComps: true });
```

- [ ] **Step 2: Verify the entitlement tests fail for the missing module**

Run: `npm test -- src/lib/auth/feature-access.test.ts`

Expected: FAIL because `feature-access.ts` does not exist.

- [ ] **Step 3: Implement the server-only entitlement module**

Implement these exact exports:

```ts
export type FeatureEntitlement = "liveEbayPublish" | "ebayDelist" | "paidComps";
export type FeatureAccess = Record<FeatureEntitlement, boolean>;

export const FEATURE_ACCESS_COPY = {
  liveEbayPublish: "Live eBay publishing is currently enabled for selected alpha accounts.",
  ebayDelist: "Live eBay delisting is currently enabled for selected alpha accounts.",
  paidComps: "Fresh sold comps are currently enabled for selected alpha accounts.",
} as const;

export function featureAccessForUser(
  user: { email?: string | null },
  env: Record<string, string | undefined> = process.env,
): FeatureAccess;

export function requireFeatureAccess(
  user: { email?: string | null },
  entitlement: FeatureEntitlement,
  env?: Record<string, string | undefined>,
): void;

export function configuredFeatureEmails(
  env?: Record<string, string | undefined>,
): Record<FeatureEntitlement, string[]>;
```

`requireFeatureAccess` throws `AppError(copy, 403, code)` where codes are `LIVE_EBAY_PUBLISH_ALPHA_ONLY`, `EBAY_DELIST_ALPHA_ONLY`, and `PAID_COMPS_ALPHA_ONLY`. Keep the module server-only and never reference `ADMIN_EMAILS`.

- [ ] **Step 4: Verify entitlement tests pass**

Run: `npm test -- src/lib/auth/feature-access.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing capability route/provider tests**

Test that `GET /api/capabilities` requires auth and returns only the three booleans plus safe copy, never configured email lists. Render the provider with a mocked API response and assert `useFeatureAccess()` exposes loading, access, and copy without reading client env.

- [ ] **Step 6: Implement the capability route and provider**

The route shape is:

```ts
return NextResponse.json({
  access: featureAccessForUser(user),
  copy: FEATURE_ACCESS_COPY,
});
```

Add `api.getFeatureAccess(token)`. Mount `FeatureAccessProvider` inside `SessionProvider` in `src/app/(app)/layout.tsx`, wrapping sidebar and page content. On fetch failure, fail closed to all `false` and retain safe copy.

- [ ] **Step 7: Run focused capability tests**

Run: `npm test -- src/lib/auth/feature-access.test.ts src/app/api/capabilities/route.test.ts src/components/providers/feature-access-provider.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit feature entitlement foundation**

```bash
git add src/lib/auth/feature-access.ts src/lib/auth/feature-access.test.ts src/app/api/capabilities src/components/providers/feature-access-provider.tsx src/components/providers/feature-access-provider.test.tsx 'src/app/(app)/layout.tsx' src/lib/api/client.ts
git commit -m "feat: add alpha feature entitlements"
```

### Task 2: Enforce allowlists on single publish and delist before side effects

**Files:**
- Modify: `src/app/api/listings/publish/route.ts`
- Modify: `src/app/api/listings/publish/route.test.ts`
- Modify: `src/app/api/listings/delist/route.ts`
- Create: `src/app/api/listings/delist/route.test.ts`
- Modify: `src/lib/marketplace/publish-handler.ts`
- Modify: `src/lib/marketplace/publish-handler.test.ts`
- Modify: `src/lib/view/types.ts`
- Modify: `src/lib/view/server-map.ts`
- Modify: `src/lib/view/server-map.test.ts`

- [ ] **Step 1: Add failing route tests for non-allowlisted users**

Mock authenticated users with valid IDs but unlisted emails. Assert publish/delist return 403 with the stable code and safe alpha copy, and assert `executePublish`/`executeEbayDelist`, Prisma writes, and outbound adapter mocks are not called.

- [ ] **Step 2: Verify denial tests fail before route enforcement**

Run: `npm test -- src/app/api/listings/publish/route.test.ts src/app/api/listings/delist/route.test.ts`

Expected: FAIL because the routes do not yet call `requireFeatureAccess`.

- [ ] **Step 3: Add route-level entitlement checks**

Immediately after `requireSupabaseUser(request)`, call:

```ts
requireFeatureAccess(user, "liveEbayPublish"); // publish route
requireFeatureAccess(user, "ebayDelist");      // delist route
```

Serialize `AppError.code` in a safe payload:

```ts
{ error: { code: error.code ?? "REQUEST_FAILED", message: error.message } }
```

Do not change existing typed eBay payload handling.

- [ ] **Step 4: Add bulk correlation support to the canonical publish service**

Extend `ExecutePublishInput` with `bulkRunId?: string`. Store `bulkRunId` in the initial `PublishAttempt.adapterResult`, preserve it in not-enabled/success/failure updates, and include it in publish events. Extend `AttemptView`/`mapAttempt` with `bulkRunId: string | null`. Single publish passes no value and remains unchanged.

- [ ] **Step 5: Run publish/delist/handler/view tests**

Run: `npm test -- src/app/api/listings/publish/route.test.ts src/app/api/listings/delist/route.test.ts src/lib/marketplace/publish-handler.test.ts src/lib/view/server-map.test.ts`

Expected: PASS, including existing ownership, ready-state, duplicate, and failure persistence tests.

- [ ] **Step 6: Commit single-action server enforcement**

```bash
git add src/app/api/listings/publish src/app/api/listings/delist src/lib/marketplace/publish-handler.ts src/lib/marketplace/publish-handler.test.ts src/lib/view/types.ts src/lib/view/server-map.ts src/lib/view/server-map.test.ts
git commit -m "feat: gate live ebay actions by alpha access"
```

### Task 3: Enforce paid-comp entitlement and identity without breaking manual comps

**Files:**
- Modify: `src/lib/comps/fetch.ts`
- Modify: `src/lib/comps/fetch.test.ts`
- Modify: `src/lib/comps/fetch-paid-budget.test.ts`
- Modify: `src/app/api/listings/comps/refresh/route.ts`
- Modify: `src/app/api/listings/comps/refresh/route.test.ts`
- Modify: `src/app/api/listings/comps/route.ts`
- Modify: `src/app/api/listings/comps/route.test.ts`
- Modify: `src/app/api/listings/draft/route.ts`
- Modify: `src/app/api/listings/draft/route.test.ts`
- Modify: `src/components/app/auto-pricing.tsx`
- Modify: `src/lib/comps/seller-copy.ts`
- Modify: `src/lib/comps/seller-copy.test.ts`

- [ ] **Step 1: Write failing paid entitlement and weak-identity tests**

Cover:

- non-allowlisted refresh returns 403 before `CompSearchRun`, ledger reservation, or provider call;
- allowlisted strong branded item reaches a mocked paid provider;
- allowlisted weak/generic item records a zero-cost `weak_identity` skip and never calls the paid provider, even with `{ force: true }`;
- free sources may still run for a weak item;
- manual `POST /api/listings/comps` remains available when paid entitlement, budget, or cooldown is unavailable;
- auto-discovery after draft creation passes `paidProvidersAllowed` based on the authenticated email.

- [ ] **Step 2: Verify focused comp tests fail**

Run: `npm test -- src/app/api/listings/comps/refresh/route.test.ts src/lib/comps/fetch.test.ts src/lib/comps/fetch-paid-budget.test.ts`

Expected: FAIL because refresh has no entitlement check and `force` bypasses weak identity.

- [ ] **Step 3: Make paid-provider permission explicit in `runCompFetch`**

Change options to:

```ts
export type RunCompFetchOptions = {
  sources?: CompSource[];
  force?: boolean;
  paidProvidersAllowed?: boolean;
};
```

Default `paidProvidersAllowed` to `false`. Split enabled sources into free and paid. When identity is weak or permission is false, exclude paid sources before reservation/call; record `weak_identity` only for an allowlisted weak item, and do not record cost for non-allowlisted users. Remove `!options.force` from identity eligibility. Continue running free sources and preserve manual comps.

- [ ] **Step 4: Gate refresh and auto-discovery call sites**

In refresh: authenticate, `requireFeatureAccess(user, "paidComps")`, then call `runCompFetch(..., { force: true, paidProvidersAllowed: true })`.

In draft creation: compute `featureAccessForUser(user).paidComps` and pass it as `paidProvidersAllowed`; auto discovery may still run free sources for other sellers.

In comps GET: report `paidProvidersEnabled` as global kill switch AND current-user entitlement. Keep provider IDs transformed through seller-copy utilities.

- [ ] **Step 5: Update pricing UI unavailable states**

Use `useFeatureAccess()`. For non-allowlisted sellers, show “Fresh sold comps are currently enabled for selected alpha accounts,” retain the manual-comp action, and do not render an inert refresh button. For allowlisted sellers, retain refresh, spinner, cooldown countdown, safe budget/quota/identity copy, and manual fallback.

- [ ] **Step 6: Run all focused comp tests**

Run: `npm test -- src/lib/comps src/app/api/listings/comps src/app/api/listings/draft/route.test.ts`

Expected: PASS with no paid call in non-allowlisted or weak-identity cases.

- [ ] **Step 7: Commit paid-comp alpha enforcement**

```bash
git add src/lib/comps src/app/api/listings/comps src/app/api/listings/draft/route.ts src/app/api/listings/draft/route.test.ts src/components/app/auto-pricing.tsx
git commit -m "feat: gate paid comps and enforce identity quality"
```

### Task 4: Build uncapped product-facing bulk preflight and execution

**Files:**
- Create: `src/lib/marketplace/bulk-publish-request.ts`
- Create: `src/lib/marketplace/bulk-publish-request.test.ts`
- Create: `src/lib/marketplace/bulk-publish.ts`
- Create: `src/lib/marketplace/bulk-publish.test.ts`
- Create: `src/app/api/listings/publish/bulk/preflight/route.ts`
- Create: `src/app/api/listings/publish/bulk/preflight/route.test.ts`
- Create: `src/app/api/listings/publish/bulk/route.ts`
- Create: `src/app/api/listings/publish/bulk/route.test.ts`

- [x] **Step 1: Write failing schemas/config tests**

Define request schemas that deduplicate UUID item IDs, require at least one ID, validate optional `bulkRunId` as UUID, and require `confirmLivePublish: true` only for execution. Define server controls:

```ts
export type BulkPublishConfig = {
  maxItemsPerRequest: number; // default 1000; env BULK_PUBLISH_MAX_ITEMS
  chunkSize: number;          // default 20; env BULK_PUBLISH_CHUNK_SIZE
  concurrency: number;        // default 2; env BULK_PUBLISH_CONCURRENCY, clamp 1..3
};
```

Test that 11, 50, and 250 selected IDs are accepted; there is no low fixed product cap. Test the high configurable transport ceiling separately.

- [x] **Step 2: Verify request/config tests fail**

Run: `npm test -- src/lib/marketplace/bulk-publish-request.test.ts`

Expected: FAIL because the new modules do not exist.

- [x] **Step 3: Implement request schemas and bounded concurrency helper**

Implement `loadBulkPublishConfig(env)`, `uniqueItemIds(ids)`, and a deterministic `processInChunks<T, R>(items, config, worker)` that never runs more than configured concurrency and preserves input order.

- [x] **Step 4: Write failing bulk service tests**

Test preflight and execution with dependency injection:

- every selected ID is seller-scoped and preflighted;
- unknown/unowned IDs return a generic rejected result;
- incomplete items return `needs_details` with friendly missing labels;
- already-listed/in-flight/succeeded items return `skipped` without an outbound call;
- 25+ ready items are processed across chunks;
- one item failure does not stop other items;
- concurrency never exceeds the configured value;
- execution passes one shared `bulkRunId` to `executePublish`;
- raw thrown errors are converted to stable seller-safe results.

- [x] **Step 5: Implement the bulk service around canonical functions**

Expose:

```ts
export async function preflightBulkEbayPublish(
  prisma: BulkPublishPrismaLike,
  input: { userId: string; itemIds: string[]; livePublishAllowed: boolean },
  deps?: BulkPublishDeps,
): Promise<BulkPreflightResult>;

export async function executeBulkEbayPublish(
  prisma: PublishPrismaLike,
  input: { userId: string; itemIds: string[]; bulkRunId: string },
  deps?: BulkPublishDeps,
): Promise<BulkExecutionResult>;
```

Preflight may call the existing eBay dry-run and prepare public derivatives, but never creates/modifies an eBay listing. Execution calls `executePublish` for each item so ownership, ready state, eBay readiness, global gate, and DB duplicate protection are rechecked.

- [x] **Step 6: Implement and test route boundaries**

Preflight requires authentication and seller scoping but remains available to non-allowlisted users; it returns `livePublishAllowed: false` and alpha copy. Execution requires `LIVE_EBAY_PUBLISH_EMAILS` before invoking the service and requires explicit confirmation. Both routes validate JSON with Zod and return safe errors.

Run: `npm test -- src/lib/marketplace/bulk-publish-request.test.ts src/lib/marketplace/bulk-publish.test.ts src/app/api/listings/publish/bulk`

Expected: PASS.

- [x] **Step 7: Commit bulk server functionality**

```bash
git add src/lib/marketplace/bulk-publish* src/app/api/listings/publish/bulk
git commit -m "feat: add safe bulk ebay publishing"
```

### Task 5: Add bulk publish UI for all selected eligible listings

**Files:**
- Create: `src/components/app/bulk-publish-modal.tsx`
- Create: `src/components/app/bulk-publish-modal.test.tsx`
- Modify: `src/app/(app)/inventory/page.tsx`
- Modify: `src/lib/api/client.ts`
- Modify: `src/components/ui/primitives.tsx` only if the existing modal cannot render long per-item results accessibly

- [ ] **Step 1: Write failing bulk modal rendering tests**

Render static states for:

- 25 selected items with ready/blocked/skipped counts;
- per-item missing reasons;
- alpha-only preview state without a live confirmation action;
- allowlisted confirmation checkbox text;
- independent published/failed/skipped/needs-details results;
- retry only for results marked `retrySafe`;
- no raw error/provider payload text.

- [ ] **Step 2: Verify UI tests fail**

Run: `npm test -- src/components/app/bulk-publish-modal.test.tsx`

Expected: FAIL because the modal does not exist.

- [ ] **Step 3: Add API client methods**

Add typed `preflightBulkEbayPublish` and `executeBulkEbayPublish`. Preserve one logical `bulkRunId`. If transport chunking is needed, keep it internal to the client method: split large ID arrays into high-size request chunks, merge results in selected order, and never expose a seller-visible selection cap.

- [ ] **Step 4: Implement the modal and inventory selection flow**

Replace the current `firstSelected` single-item behavior. The selection bar must:

- pass every selected ID;
- show “Publish selected to eBay” for allowlisted accounts;
- show “Preview selected” for non-allowlisted accounts;
- keep “Export CSV” working;
- preflight on modal open;
- require “I understand this will create live eBay listings.” before execution;
- refresh inventory after completion while retaining per-item results until the modal closes.

- [ ] **Step 5: Run bulk UI and inventory tests**

Run: `npm test -- src/components/app/bulk-publish-modal.test.tsx src/app/api/listings/publish/bulk src/lib/marketplace/bulk-publish.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit bulk UI**

```bash
git add src/components/app/bulk-publish-modal.tsx src/components/app/bulk-publish-modal.test.tsx 'src/app/(app)/inventory/page.tsx' src/lib/api/client.ts src/components/ui/primitives.tsx
git commit -m "feat: publish all selected ebay listings"
```

### Task 6: Make single-item publish, delist, archive, and delete states honest

**Files:**
- Modify: `src/components/app/publish-modal.tsx`
- Modify: `src/components/app/publish-modal.test.tsx`
- Modify: `src/components/app/marketplace-operations-panel.tsx`
- Modify: `src/components/app/marketplace-operations-panel.test.tsx`
- Modify: `src/app/(app)/inventory/[id]/page.tsx`
- Modify: `src/app/api/listings/route.ts`
- Create: `src/app/api/listings/route.test.ts`
- Create: `src/lib/view/inventory-actions.ts`
- Create: `src/lib/view/inventory-actions.test.ts`

- [ ] **Step 1: Write failing seller-state and delete-safety tests**

Cover:

- non-allowlisted ready item promotes Preview and shows exact alpha copy;
- allowlisted ready item shows “Publish to eBay” and explicit live confirmation;
- live stored listing shows “End eBay listing” only when delist-entitled, otherwise alpha copy;
- draft/ready items show “Archive listing” or “Delete draft,” not ambiguous local “Delist”;
- server delete rejects any owned item with `LISTED`, `PUBLISHING`, or `DELISTING` marketplace artifacts and does not cascade it;
- bulk delete deletes safe drafts and returns blocked live item IDs/reasons independently;
- published eBay item opens `https://www.ebay.com/itm/{externalListingId}`; otherwise the dead “View live” button is absent.

- [ ] **Step 2: Verify focused tests fail**

Run: `npm test -- src/components/app/publish-modal.test.tsx src/components/app/marketplace-operations-panel.test.tsx src/app/api/listings/route.test.ts src/lib/view/inventory-actions.test.ts`

Expected: FAIL on missing feature-aware behavior and live-delete protection.

- [ ] **Step 3: Implement feature-aware action rendering**

Pass `FeatureAccess` from `useFeatureAccess()` into publish and marketplace-operation components. Keep preflight/preview for everyone. Hide—not disable without explanation—unavailable live mutations, and render the required alpha copy with manual alternatives.

- [ ] **Step 4: Implement server-side delete partitioning**

Before `deleteMany`, load seller-owned selected items and their marketplace listing statuses. Return:

```ts
{
  deleted: string[],
  blocked: Array<{ itemId: string; reason: "LIVE_MARKETPLACE_LISTING" }>,
}
```

Only delete IDs without live/in-flight artifacts. Update single and bulk UI copy from response results.

- [ ] **Step 5: Run action/delete tests**

Run: `npm test -- src/components/app/publish-modal.test.tsx src/components/app/marketplace-operations-panel.test.tsx src/app/api/listings/route.test.ts src/lib/view/inventory-actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit honest action and deletion behavior**

```bash
git add src/components/app/publish-modal.tsx src/components/app/publish-modal.test.tsx src/components/app/marketplace-operations-panel.tsx src/components/app/marketplace-operations-panel.test.tsx 'src/app/(app)/inventory/[id]/page.tsx' src/app/api/listings/route.ts src/app/api/listings/route.test.ts src/lib/view/inventory-actions.ts src/lib/view/inventory-actions.test.ts
git commit -m "fix: prevent misleading live listing actions"
```

### Task 7: Finish search, marketplace, and inventory-sync honesty audit

**Files:**
- Modify: `src/app/(app)/inventory/page.tsx`
- Modify: `src/lib/view/inventory-actions.ts`
- Modify: `src/lib/view/inventory-actions.test.ts`
- Modify: `src/app/(app)/channels/page.tsx`
- Modify: `src/app/api/jobs/route.ts`
- Modify: `src/app/api/jobs/route.test.ts`
- Modify: `src/lib/marketplace/adapter.ts` only if capability reporting needs a separate eBay live-publish capability

- [ ] **Step 1: Add failing search and channel-copy tests**

Test inventory search over title, brand, category, lifecycle/status label, and ID; no-match copy; clear-search behavior; and channel API/UI copy that reflects eBay preview/live publish capability without claiming sync exists.

- [ ] **Step 2: Verify tests fail on current dead/incorrect states**

Run: `npm test -- src/lib/view/inventory-actions.test.ts src/app/api/jobs/route.test.ts`

Expected: FAIL because search omits category/status and jobs hardcodes publishing as unimplemented.

- [ ] **Step 3: Implement searchable fields and marketplace actions**

Move `matchesSearch` into `inventory-actions.ts`. On `/channels`:

- replace disabled “Connect marketplace” with a working link/action to `/settings/marketplaces`;
- report eBay live publishing based on global gate plus current entitlement;
- remove disabled CSV/settings controls or wire them to inventory export and marketplace settings;
- remove “publishing not implemented” copy for entitled eBay users;
- preserve honest assisted/draft-only copy for other marketplaces.

- [ ] **Step 4: Keep inventory sync unavailable because implementation is incomplete**

The audit found only queue schemas/capability placeholders, no user-triggered official eBay reconciliation service. Keep `inventorySync: false`, remove/hide sync buttons, and show “Live eBay inventory sync is not available yet” only where explanatory copy is useful. Do not enqueue a fake job and do not imply sync occurred.

- [ ] **Step 5: Run search/jobs/channel tests**

Run: `npm test -- src/lib/view/inventory-actions.test.ts src/app/api/jobs/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit dead-action and search audit**

```bash
git add 'src/app/(app)/inventory/page.tsx' 'src/app/(app)/channels/page.tsx' src/app/api/jobs/route.ts src/app/api/jobs/route.test.ts src/lib/view/inventory-actions.ts src/lib/view/inventory-actions.test.ts src/lib/marketplace/adapter.ts
git commit -m "fix: remove dead marketplace actions"
```

### Task 8: Add admin visibility for feature access and marketplace operations

**Files:**
- Create: `src/app/api/admin/marketplace-operations/route.ts`
- Create: `src/app/api/admin/marketplace-operations/route.test.ts`
- Create: `src/app/(app)/admin/marketplace-operations/page.tsx`
- Create: `src/components/app/admin-nav.tsx`
- Modify: `src/app/(app)/admin/provider-usage/page.tsx`
- Modify: `src/app/(app)/admin/feedback/page.tsx`
- Modify: `src/lib/api/client.ts`

- [ ] **Step 1: Write failing admin route tests**

Cover unauthenticated/non-admin 404 behavior, exact configured feature-email visibility only to admins, recent publish/delist attempts, bulk run IDs, safe eBay identifiers/status, and exclusion of adapter payloads, tokens, environment values, raw errors, and provider response data.

- [ ] **Step 2: Verify admin tests fail**

Run: `npm test -- src/app/api/admin/marketplace-operations/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement read-only admin operations API**

Use `requireAdminUser`. Return:

```ts
{
  access: configuredFeatureEmails(),
  attempts: Array<{
    id: string;
    requestedBy: string;
    itemId: string;
    itemTitle: string;
    action: "publish" | "delist" | "cleanup";
    status: string;
    code: string;
    bulkRunId: string | null;
    externalListingId: string | null;
    createdAt: string;
  }>;
}
```

Map only selected safe fields. Log unexpected failures as `admin_marketplace_operations_fetch_failed` and return that generic code.

- [ ] **Step 4: Implement the admin page/navigation**

Add a compact admin nav shared by feedback, provider usage, and marketplace operations. Show allowlist membership, paid usage link/cards, and recent item-level publish/delist/bulk results. Keep the existing server layout guard and independent API guard.

- [ ] **Step 5: Run admin tests and build route classification check**

Run: `npm test -- src/app/api/admin src/app/'(app)'/admin`

Expected: PASS. Later `npm run build` must classify `/admin/marketplace-operations` as a dynamic server-rendered route.

- [ ] **Step 6: Commit admin operations visibility**

```bash
git add src/app/api/admin/marketplace-operations 'src/app/(app)/admin' src/components/app/admin-nav.tsx src/lib/api/client.ts
git commit -m "feat: add marketplace operations admin view"
```

### Task 9: Document env posture, rollout, smoke, and rollback

**Files:**
- Modify: `.env.example`
- Create: `docs/ALPHA_LIVE_ACTIONS.md`
- Modify: `README.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Add environment names with safe example values**

Document without real emails/secrets:

```dotenv
LIVE_EBAY_PUBLISH_EMAILS=""
EBAY_DELIST_EMAILS=""
PAID_COMPS_EMAILS=""
BULK_PUBLISH_MAX_ITEMS="1000"
BULK_PUBLISH_CHUNK_SIZE="20"
BULK_PUBLISH_CONCURRENCY="2"
```

Retain the existing global kill switches and document the intended production caps by name: paid budget 500 cents/day, user limits 5/day and 25/month, both cooldowns 3600 seconds, provider results 10, query variants 1, admin override false.

- [ ] **Step 2: Write the operator runbook**

Include gate matrix, server-side enforcement points, feature-specific disable procedure, current production rollback lookup commands, migration statement (“none expected; never use `prisma db push`”), controlled publish/bulk/delist/comps smoke, Seller Hub checks, orphan cleanup, log secret scan, and final report checklist.

- [ ] **Step 3: Update README and HANDOFF without secrets**

README links to the runbook. HANDOFF records branch, code state, gate state, and next release step; it must not claim deployment before deployment occurs.

- [ ] **Step 4: Validate documentation and commit**

Run: `rg -n "TBD|TODO|actual-token|@example\.com" docs/ALPHA_LIVE_ACTIONS.md README.md HANDOFF.md .env.example`

Expected: no placeholders or real secret-like values; only intentionally blank/example allowlists.

```bash
git add .env.example docs/ALPHA_LIVE_ACTIONS.md README.md HANDOFF.md
git commit -m "docs: add alpha live actions runbook"
```

### Task 10: Run complete local verification and review

**Files:**
- Review all changed files
- Modify only files required to fix discovered failures

- [ ] **Step 1: Run schema and static gates**

```bash
npx prisma generate
npx prisma validate
npm run lint
npx tsc --noEmit
```

Expected: all exit 0; report any known lint warnings separately.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all test files and tests pass with zero failures.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit 0; admin operations route/page present and dynamic where applicable.

- [ ] **Step 4: Audit requirements and secrets**

Re-read the design acceptance mapping and inspect `git diff develop...HEAD`. Search changed files for raw token/payload rendering and accidental provider IDs in seller UI. Verify no schema migration and no `prisma db push` usage.

- [ ] **Step 5: Request code review and address actionable findings**

Use the repository review workflow on `feature/alpha-live-actions`; rerun focused tests after each correction, then rerun the full gate.

- [ ] **Step 6: Commit final verified corrections and update HANDOFF**

```bash
git add HANDOFF.md
git commit -m "test: verify alpha live marketplace actions"
```

### Task 11: Promote and configure production safely

**Files:**
- Git/Vercel state only until a release-note or HANDOFF update is required

- [ ] **Step 1: Record current production and rollback state**

Run `vercel inspect sello.wtf` and `vercel ls --prod`. Record deployment IDs only. Confirm production env names with `vercel env ls production`; never print or report values.

- [ ] **Step 2: Merge through the required release flow**

Merge verified `feature/alpha-live-actions -> develop`, verify the existing local landing-page commits remain, rerun the full gate on merged `develop`, then merge `develop -> main` using the repository’s `[deploy]` release convention. Push only the explicitly approved release branches.

- [ ] **Step 3: Configure production env names**

Set `LIVE_EBAY_PUBLISH_EMAILS`, `EBAY_DELIST_EMAILS`, and `PAID_COMPS_EMAILS` to the current owner email independently; do not derive them in application code from `ADMIN_EMAILS`. Apply the documented comp caps and bulk execution controls. Keep `EBAY_PRODUCTION_PUBLISH_ENABLED` and paid providers off until the new code is serving production.

- [ ] **Step 4: Deploy code with mutations still disabled, then enable gates**

Verify the first production deployment is Ready and basic authenticated/read-only smoke passes. Then enable `EBAY_PRODUCTION_PUBLISH_ENABLED`, `COMPS_PAID_PROVIDERS_ENABLED`, and the configured sold-comp provider, redeploy, and verify the new deployment is Ready before any mutation smoke.

### Task 12: Run controlled signed-in production smoke and close out

**Files:**
- Modify: `HANDOFF.md`
- Modify: `docs/ALPHA_LIVE_ACTIONS.md` only if the live procedure differs from the runbook

- [ ] **Step 1: Smoke capability states**

Using the existing authenticated production browser session, verify the owner sees live actions and a non-allowlisted fixture/session (if safely available) sees exact alpha copy with preview/export/manual comps retained.

- [ ] **Step 2: Smoke one single publish**

Create a disposable, policy-compliant item; complete readiness; explicitly confirm; publish; verify Sello status, eBay listing ID/link, Seller Hub listing, duplicate prevention, and sanitized UI. Record the listing for cleanup.

- [ ] **Step 3: Smoke bulk publish without a product cap**

Use at least two ready disposable items plus one blocked item. Verify all selected IDs reach preflight, counts/reasons are correct, confirmation is required, ready items publish independently, blocked item skips, retry does not duplicate, and one result does not suppress others.

- [ ] **Step 4: Smoke paid comps**

Refresh one strong branded item and verify sold comps, recommendation, one provider ledger charge, admin usage, and one-hour cooldown. Refresh one weak generic item and verify zero provider calls/cost plus clear identity copy. Verify manual comps after limits/cooldown.

- [ ] **Step 5: Smoke delist/delete and cleanup all marketplace artifacts**

End one disposable live eBay listing through the confirmed delist flow; verify Seller Hub and Sello status. Delete/archive a local draft. Verify live listings cannot be locally deleted. End remaining test listings and run orphan scan/cleanup until no test inventory item, offer, or live listing remains.

- [ ] **Step 6: Smoke search and dead actions**

Search title, brand, category, and status; verify no-match and clear states. Walk every primary action named in the design and prove it works, is hidden, or has an exact unavailable reason. Confirm inventory sync remains honestly unavailable and performs no publish/delist.

- [ ] **Step 7: Scan production logs and decide keep/rollback**

Inspect Vercel logs for HTTP 500/error/fatal, token/secret-like strings, raw eBay/provider errors, and unexpected publish/provider call counts. If unsafe, disable the relevant feature allowlist/global kill switch first and redeploy; promote the recorded prior deployment if the app is unhealthy.

- [ ] **Step 8: Update HANDOFF and produce the 14-part report**

Record final deployment ID, rollback deployment, env names changed, smoke outcomes, cleanup proof, logs verdict, remaining blockers, and exact gate status without values. Run `git status --short --branch` and ensure release branches/worktrees are in the intended state.
