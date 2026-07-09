# Sello billing, usage metering, and team seats (design)

Status: **DESIGN APPROVED, not implemented.** Brainstormed 2026-06-24. Build is
phased; each phase is independently shippable and reviewed through `develop`.

## Summary

Stand up Stripe subscriptions and the full pricing flow for Sello with three
tiers (Free / Pro / Kingpin). Tiers are defined by **usage limits and feature
flags**, not feature flags alone, so this includes net-new usage metering and
quota enforcement. Kingpin includes shared-workspace team seats, which requires
moving seller-scoped data ownership from per-user to per-account.

The enabling decision: introduce an `Account` from day one (one user equals one
personal account), and attach billing plus usage to the account. Existing item
tables stay user-scoped through Phases 1 to 3 (one account has exactly one
member, so user scope equals account scope). Only the seats phase migrates item
scoping to a shared account. Billing and metering are account-keyed from the
start and are never rewritten when seats land.

## Goals

- Three live plans in Stripe (test mode first): Free $0, Pro $20/mo, Kingpin
  $119/mo.
- Self-serve subscribe, upgrade, downgrade, cancel, and card management with no
  card data touching the app.
- Plan resolves to entitlements (limits and feature flags) that gate real
  behavior.
- Monthly usage metering and quota enforcement on AI listings, autopublishes,
  and comp refreshes, plus per-plan caps on bulk batch size and marketplace
  connections.
- Kingpin shared-workspace team seats (invite, accept, roles, seat limit).
- A public pricing page and an in-app billing settings surface with usage
  meters.

## Non-goals (explicitly out of scope)

- Building the premium product features that the plans gate (full inventory
  sync engine, auto-delist execution, email/API sold detection, advanced comp
  intelligence, repricing, dead-stock detection, performance analytics). Most
  are dormant per `HANDOFF.md`. Billing gates them; gating an unbuilt feature is
  a flag that stays off until that feature ships separately.
- Annual billing, usage-based overage billing, multiple payment methods, and
  tax/VAT configuration. Notable future work, not this pass.
- Replacing the existing safety/rollout allowlist in `feature-access.ts`. It
  stays as an orthogonal safety gate (see "Two-gate model").
- **Any RLS change.** RLS hardening is a separate in-flight effort and this work
  does not touch it (see "RLS is out of scope").

## Plan catalog (single source of truth)

`src/lib/billing/plans.ts` holds one typed catalog that drives Stripe, gating,
metering, and UI. Values from the approved tier table:

| | Free | Pro ($20) | Kingpin ($119) |
|---|---:|---:|---:|
| AI listings / month | 10 | 125 | 1000 |
| Autopublishes / month | 10 | 125 | 1000 |
| Comp refreshes / month | 10 | 100 | 750 |
| Marketplace connections | 1 | 3 | 5 |
| Bulk batch size | 5 | 25 | 250 |
| Team seats | 1 | 1 | 5 |

Feature flags (boolean unless noted), resolved per plan:

| Flag | Free | Pro | Kingpin |
|---|:-:|:-:|:-:|
| `basicAnalytics` | no | yes | yes |
| `profitTracking` | none | simple | advanced |
| `templates` | no | yes | yes |
| `assistedSoldDelist` | no | yes | yes |
| `fullInventorySync` | no | no | yes |
| `autoDelist` | no | no | yes |
| `soldDetection` | no | no | yes |
| `advancedComps` | no | no | yes |
| `advancedAnalytics` | no | no | yes |
| `repricing` | no | no | yes |
| `deadStock` | no | no | yes |
| `performanceAnalytics` | no | no | yes |
| `priorityQueue` | no | no | yes |
| `prioritySupport` | no | no | yes |

Shape: `PLAN_CATALOG: Record<PlanId, { stripePriceId: string | null; limits;
features }>` where `PlanId = "free" | "pro" | "kingpin"` and Free has
`stripePriceId: null`. Helpers: `planForPriceId`, `limitsFor`, `featuresFor`.
The exact flag list is finalized in implementation; the values above are the
contract.

## Data model (Prisma)

New models. Item tables are unchanged until Phase 4.

- `Account` — `id`, `ownerUserId` (uuid), `plan` (enum free/pro/kingpin,
  default free), timestamps.
- `AccountMember` — `id`, `accountId`, `userId?` (null until an invite is
  accepted), `invitedEmail`, `role` (owner/admin/member), `status`
  (active/invited/revoked), timestamps. Unique `(accountId, userId)`. Phase 1
  seeds only the owner row; the rest is real in Phase 4.
- `Subscription` — one per account: `accountId` (unique), `stripeCustomerId`,
  `stripeSubscriptionId?`, `plan`, `status` (mirrors Stripe: active, trialing,
  past_due, canceled, incomplete, unpaid), `currentPeriodStart`,
  `currentPeriodEnd`, `cancelAtPeriodEnd`, timestamps.
- `UsageCounter` — `accountId`, `metric` (enum: ai_listing, autopublish,
  comp_refresh), `periodStart` (date), `count` (int). Unique `(accountId,
  metric, periodStart)`. Added in Phase 1, exercised in Phase 2.
- `StripeEvent` — `id` (Stripe event id, primary key), `type`, `processedAt`.
  Webhook idempotency.

Backfill: one `Account` per existing distinct owner, with the owner
`AccountMember`. New signups get an account on first authenticated load via
`getOrCreateAccount(userId)`.

## Stripe integration

- Dependency: the `stripe` Node SDK, server-only.
- Config: `src/lib/billing/config.ts` typed loader for `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_KINGPIN`, plus the
  publishable key for the client. Fail-closed in production if missing; absent
  in dev means billing is dormant (same pattern as comps). Secret values are
  never logged.
- Products and prices: two products (Pro, Kingpin) with monthly recurring
  prices ($20, $119) created in Stripe **test mode** first. Free is the absence
  of a paid subscription. Optional idempotent `scripts/stripe/sync-products.ts`
  to create/update them; price ids land in env.
- Surface: **Stripe-hosted Checkout** to subscribe and **Customer Portal** for
  upgrade/downgrade/cancel/card. No card data touches the app (zero PCI
  surface).

Routes:

- `POST /api/billing/checkout` — resolve account, ensure a Stripe customer
  (create and persist `stripeCustomerId` if missing), create a Checkout Session
  (`mode=subscription`) for the requested plan's price, `client_reference_id =
  accountId`, success and cancel URLs into settings/pricing. Returns the URL.
  Verifies the account belongs to the authed user.
- `POST /api/billing/portal` — Billing Portal session for the account's
  customer. Returns the URL.
- `POST /api/billing/webhook` — raw body, mandatory signature verification,
  idempotent via `StripeEvent`. Handles `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.payment_failed`.
  Maps Stripe price to plan, upserts `Subscription`, sets `Account.plan`.
  `runtime = "nodejs"`; reads the raw body via `request.text()`.

## Entitlements and the two-gate model

Two independent gates are ANDed on any gated action:

1. **Commercial gate (new):** does the plan grant this feature, and is the
   action within quota? `src/lib/billing/entitlements.ts` exposes
   `getEntitlements(account) -> { plan, limits, features }` and
   `requirePlanFeature(account, feature)`.
2. **Safety/rollout gate (existing, unchanged):** `feature-access.ts` keeps its
   email allowlist controlling whether a risky live integration is available at
   all (live eBay publishing, paid comps, Etsy), since production keysets are
   dormant and live actions move real money/listings.

Keeping them separate preserves the integrity rules: a paying Kingpin user still
cannot trigger live eBay publishing until the production-keyset safety gate
opens. The commercial layer does not weaken the safety layer.

Mapping note: "auto price comps" is metered for all plans; `advancedComps`
(Kingpin) is the premium tier. Live publishing remains safety-gated regardless
of plan. Free effectively cannot publish live until the safety gate opens; this
is intended and surfaced honestly in the UI.

## Usage metering and enforcement

`src/lib/billing/usage.ts`:

- `getBillingPeriod(account)` — aligns to the subscription billing cycle;
  calendar month for Free. Pure, separately tested.
- `getUsage(account, metric)`, `assertWithinQuota(account, metric)`,
  `incrementUsage(account, metric, n=1)`. The counter upsert is atomic.
  Increment happens only after the action succeeds, so failed actions do not
  burn quota.

Enforcement points:

- AI draft generation (`/api/listings/draft`) -> `ai_listing`.
- Publish and bulk publish (`/api/listings/publish`, `/publish/bulk`) ->
  `autopublish`, counted per item.
- Comps refresh (`/api/listings/comps`) -> `comp_refresh`.
- Bulk batch caps reuse the existing `maxItemsPerRequest` pattern (today's
  `BULK_PUBLISH_TOO_MANY_ITEMS`), now driven by `plan.bulkBatchSize`, applied to
  bulk publish, bulk delist, bulk CSV upload, and bulk edit.
- Marketplace connection cap at the connect routes: block when active
  connections >= `plan.marketplaceConnections`.

Typed errors (fail loudly, surfaced as upgrade prompts): `QUOTA_EXCEEDED_<METRIC>`
(402), `PLAN_FEATURE_REQUIRED` (403), `CONNECTION_LIMIT_REACHED` (403),
`BULK_BATCH_TOO_LARGE` (400).

## UI surfaces

- Public `/pricing` — three cards rendered from the catalog, CTAs (Free ->
  sign up, Pro/Kingpin -> checkout or sign-in-then-checkout).
- `settings/billing` — current plan, status, renewal date, **usage meters** per
  metric for the current period, "Manage billing" to the portal,
  upgrade/downgrade.
- Quota walls — typed errors map to an "you have hit your monthly limit,
  upgrade" CTA. Prefer clear empty/limit states over decoration.

## Security and integrity constraints

- Secret key is server-only via env, never logged, printed, or echoed. Use a
  restricted key where possible.
- Webhook signature verification is mandatory; reject unsigned/invalid events.
- No card data in the app: Checkout and Portal are Stripe-hosted.
- `client_reference_id`/metadata bind Stripe objects to the account; verify the
  account belongs to the authed user on checkout and portal.
- `DATABASE_URL` stays the `resale_app` Supabase pooler; preserve the existing
  Prisma/Supabase role strategy. Do not switch to the postgres owner.
- Run the gate before finishing each phase: `npm run lint`, `npm test`,
  `npx prisma validate`, `npm run build`.
- Test mode throughout. Flip to live keys only after full verification and
  explicit approval.

## RLS is out of scope

RLS hardening is a separate, in-flight security effort and this work does not
touch it. `docs/RLS_HARDENING_PLAN.md` stays the owner of RLS changes. Two facts
make this separation clean:

- The app runtime (`resale_app`) bypasses RLS, so app-layer query scoping is the
  real enforcement for every flow here. Billing, metering, and seats are all
  enforced in application code (Prisma `where` plus the entitlement and quota
  checks), independent of any RLS policy state.
- The browser never runs data queries against Supabase (it uses the anon key for
  auth only), so the per-user-versus-per-account predicate question does not
  affect the app at runtime.

Consequence for seats: Phase 4 changes data scoping at the **application layer
only**, moving Prisma queries from per-user to per-account-membership. It adds,
changes, and enables no RLS policy. Whoever later lands the RLS hardening will
account for the account model in their predicates; that is their effort, not
this one.

## Phased build order

Each phase ends with the gate green and is reviewed through `develop`. `main` is
protected; never pushed without explicit approval.

### Phase 0 — Foundation (no user-facing change)
- `plans.ts` catalog, `config.ts` env loader, `stripe` dependency, price->plan
  map, test-mode products/prices created (and optional sync script).
- Tests: catalog and price->plan mapping (pure).
- Acceptance: catalog and config load; zero behavior change.

### Phase 1 — Billing core / working paywall
- Prisma models (Account, AccountMember owner-seed, Subscription, UsageCounter,
  StripeEvent) and backfill migration through `develop`.
- `account.ts` (`getOrCreateAccount`, `getActiveAccount`), `ensureStripeCustomer`.
- Checkout, Portal, and Webhook routes; webhook upserts Subscription and
  `Account.plan`; everyone defaults Free.
- Tests: webhook handler (fixtures + idempotency), checkout/portal routes
  (Stripe mocked), price->plan.
- Acceptance: subscribe to Pro/Kingpin in test mode with a test card ->
  `Subscription` persisted and `Account.plan` updated; portal cancel ->
  downgrade to Free at period end.

### Phase 2 — Entitlements + metering enforcement
- `entitlements.ts` and `usage.ts`; wire the three metered actions, bulk caps,
  connection cap, and `requirePlanFeature` gates on the premium features
  (returning typed errors even though those features are dormant).
- Tests: quota math, period boundaries, increment-on-success, each enforcement
  point.
- Acceptance: Free blocked at the 11th AI listing; bulk over 5 rejected on Free,
  over 25 on Pro; second connection blocked on Free.

### Phase 3 — Pricing page + billing UI
- `/pricing`, `settings/billing` with usage meters, quota-wall UX, usage
  snapshot endpoint/server data.
- Tests: usage snapshot calculation, page state rendering.
- Acceptance: pricing page live; settings shows accurate meters; hitting a wall
  surfaces an upgrade CTA.

### Phase 4 — Team seats (shared workspace, application layer only)
- `AccountMember` becomes real: invite by email, accept on signup/login, roles,
  `status`, seat-limit enforcement (`plan.teamSeats`), revoke.
- Data-scope migration (application layer, no RLS): add `accountId` to the
  root-owned tables (the `InventoryItem` tree via `InventoryItem`, and the
  marketplace tables `MarketplaceConnection`/`EbaySellerConfig`/etc.), backfill
  `accountId` from the owner's account, switch app-layer scoping from
  `sellerId/userId = me` to account membership via a `sellerScope(account)`
  helper. Children inherit via relation as today. Writes stamp the acting user
  plus the account.
- Subscription and metering are already account-keyed, so they do not change.
- RLS is untouched (see "RLS is out of scope").
- Tests: membership resolution, seat-limit enforcement, cross-member sharing (A
  and B in one account share inventory; C in another cannot read it),
  invite/accept/revoke.
- Acceptance: a Kingpin owner invites up to the seat limit; members share one
  inventory; non-members are blocked.

## Open items to confirm at spec review

- Final feature-flag list (the table above is the contract; names may be
  adjusted to match code conventions during implementation).
- Whether the connection cap counts only "active" connections or all rows.
- Confirm Free's live-publishing behavior is acceptable: effectively unavailable
  until the safety gate opens, surfaced honestly. (Autopublish quota of 10/mo on
  Free applies once that gate is open.)
