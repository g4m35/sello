# Stripe billing, usage metering, and team seats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Stripe subscriptions (Free / Pro / Kingpin), usage metering with quota enforcement, an in-app pricing and billing surface, and shared-workspace team seats for Sello.

**Architecture:** A single typed plan catalog drives Stripe, gating, metering, and UI. An `Account` (one per user initially) owns the subscription and usage counters from day one, so billing and metering never get rewritten when seats land. Stripe-hosted Checkout and Customer Portal keep card data off the app. Enforcement is entirely application-layer (Prisma `where` + entitlement/quota checks).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 7 (`prisma-client` generator → `src/generated/prisma`), Supabase Auth, `stripe` Node SDK, Zod, Vitest, Tailwind v4.

## Global Constraints

(Every task implicitly includes these.)

- Prices, exact: Free **$0**, Pro **$20/mo**, Kingpin **$119/mo**. Stripe amounts in cents: Pro `2000`, Kingpin `11900`.
- **Stripe TEST mode only** in this plan. Never wire live (`sk_live`/`pk_live`) keys. Flip to live is a separate, explicitly-approved step.
- **RLS is out of scope.** Do not add, change, or enable any RLS policy. App-layer scoping is the enforcement (`resale_app` bypasses RLS).
- Secrets via env only; never log, print, or echo key/secret values. Webhook signature verification is mandatory.
- No card data touches the app: Checkout + Customer Portal are Stripe-hosted.
- `DATABASE_URL` stays the `resale_app` Supabase pooler. Do not change the role strategy.
- Branch flow: work on `feature/stripe-billing-metering-seats`; merge `feature/* → develop → main`. `main` is protected; never push without explicit approval. Migrations reviewed through `develop`.
- Gate before finishing each phase: `npm run lint`, `npm test`, `npx prisma validate`, `npm run build`. Commit after the gate passes.
- TypeScript strict, no `any` (prefer `unknown` + narrowing); Zod at all external boundaries; business logic in pure, tested utilities.
- Prisma client imported from `@/generated/prisma/client`; DB handle via `getPrisma()`.
- Errors: throw `AppError(message, status, code)`; route handlers respond via `safeErrorResponse(error, { label })`.
- Auth: `requireSupabaseUser(request)` returns the Supabase `User` (`{ id, email }`).
- Copy style: no em dashes (use commas, periods, or parentheses).

## File Structure

**New — billing core (`src/lib/billing/`)**
- `plans.ts` — `PlanId`, `PLAN_CATALOG`, limits/features types, `planForPriceId`, `limitsFor`, `featuresFor`. Pure, no I/O.
- `config.ts` — `loadStripeConfig(env)` typed loader; `isBillingConfigured(env)`.
- `stripe.ts` — `getStripe()` singleton SDK client (server-only).
- `account.ts` — `getOrCreateAccount(userId)`, `getActiveAccount(userId)`, `ensureStripeCustomer(account)`.
- `entitlements.ts` — `getEntitlements(account)`, `requirePlanFeature(account, feature)`.
- `usage.ts` — `getBillingPeriod(account)`, `getUsage`, `assertWithinQuota`, `incrementUsage`.
- `webhook.ts` — `handleStripeEvent(event)` pure-ish handler (DB writes via injected prisma).
- `errors.ts` — typed billing error factories (quota, plan-feature, connection-limit).

**New — routes (`src/app/api/billing/`)**
- `checkout/route.ts`, `portal/route.ts`, `webhook/route.ts`, `usage/route.ts`.

**New — UI**
- `src/app/pricing/page.tsx` (public), plus `src/components/billing/plan-cards.tsx`.
- `src/app/(app)/settings/billing/page.tsx`, plus `src/components/billing/usage-meter.tsx`, `upgrade-cta.tsx`.

**New — Prisma**
- `prisma/schema.prisma` (append models/enums), one migration dir, `prisma/migrations/billing-models.test.ts`.

**New — script**
- `scripts/stripe/sync-products.ts` — idempotent test-mode product/price creator.

**Modified — enforcement wiring**
- `src/app/api/listings/draft/route.ts` (ai_listing), `.../publish/route.ts` + `publish/bulk/route.ts` (autopublish), `.../comps/route.ts` (comp_refresh), marketplace connect routes (connection cap), bulk routes (batch cap).

---

## Phase 0 — Foundation

### Task 0.1: Plan catalog

**Files:**
- Create: `src/lib/billing/plans.ts`
- Test: `src/lib/billing/plans.test.ts`

**Interfaces:**
- Produces:
  - `type PlanId = "free" | "pro" | "kingpin"`
  - `interface PlanLimits { aiListingsPerMonth: number; autopublishesPerMonth: number; compRefreshesPerMonth: number; marketplaceConnections: number; bulkBatchSize: number; teamSeats: number }`
  - `interface PlanFeatures { basicAnalytics: boolean; profitTracking: "none" | "simple" | "advanced"; templates: boolean; assistedSoldDelist: boolean; fullInventorySync: boolean; autoDelist: boolean; soldDetection: boolean; advancedComps: boolean; advancedAnalytics: boolean; repricing: boolean; deadStock: boolean; performanceAnalytics: boolean; priorityQueue: boolean; prioritySupport: boolean }`
  - `type FeatureFlag = keyof PlanFeatures`
  - `interface Plan { id: PlanId; name: string; priceCents: number; stripePriceIdEnv: string | null; limits: PlanLimits; features: PlanFeatures }`
  - `const PLAN_CATALOG: Record<PlanId, Plan>`
  - `function planForPriceId(priceId: string, env?): PlanId | null`
  - `function limitsFor(plan: PlanId): PlanLimits`
  - `function featuresFor(plan: PlanId): PlanFeatures`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { PLAN_CATALOG, limitsFor, featuresFor, planForPriceId } from "./plans";

describe("plan catalog", () => {
  it("encodes the approved limits", () => {
    expect(limitsFor("free").aiListingsPerMonth).toBe(10);
    expect(limitsFor("pro").aiListingsPerMonth).toBe(125);
    expect(limitsFor("kingpin").aiListingsPerMonth).toBe(1000);
    expect(limitsFor("pro").marketplaceConnections).toBe(3);
    expect(limitsFor("kingpin").bulkBatchSize).toBe(250);
    expect(limitsFor("kingpin").teamSeats).toBe(5);
  });

  it("encodes prices in cents", () => {
    expect(PLAN_CATALOG.free.priceCents).toBe(0);
    expect(PLAN_CATALOG.pro.priceCents).toBe(2000);
    expect(PLAN_CATALOG.kingpin.priceCents).toBe(11900);
  });

  it("gates kingpin-only features", () => {
    expect(featuresFor("pro").fullInventorySync).toBe(false);
    expect(featuresFor("kingpin").fullInventorySync).toBe(true);
    expect(featuresFor("free").basicAnalytics).toBe(false);
    expect(featuresFor("pro").basicAnalytics).toBe(true);
  });

  it("maps a stripe price id back to its plan", () => {
    const env = { STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_KINGPIN: "price_king" };
    expect(planForPriceId("price_pro", env)).toBe("pro");
    expect(planForPriceId("price_king", env)).toBe("kingpin");
    expect(planForPriceId("price_unknown", env)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run src/lib/billing/plans.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `plans.ts`**

```ts
export type PlanId = "free" | "pro" | "kingpin";

export interface PlanLimits {
  aiListingsPerMonth: number;
  autopublishesPerMonth: number;
  compRefreshesPerMonth: number;
  marketplaceConnections: number;
  bulkBatchSize: number;
  teamSeats: number;
}

export interface PlanFeatures {
  basicAnalytics: boolean;
  profitTracking: "none" | "simple" | "advanced";
  templates: boolean;
  assistedSoldDelist: boolean;
  fullInventorySync: boolean;
  autoDelist: boolean;
  soldDetection: boolean;
  advancedComps: boolean;
  advancedAnalytics: boolean;
  repricing: boolean;
  deadStock: boolean;
  performanceAnalytics: boolean;
  priorityQueue: boolean;
  prioritySupport: boolean;
}

export type FeatureFlag = keyof PlanFeatures;

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  stripePriceIdEnv: string | null;
  limits: PlanLimits;
  features: PlanFeatures;
}

const NO_FEATURES: PlanFeatures = {
  basicAnalytics: false,
  profitTracking: "none",
  templates: false,
  assistedSoldDelist: false,
  fullInventorySync: false,
  autoDelist: false,
  soldDetection: false,
  advancedComps: false,
  advancedAnalytics: false,
  repricing: false,
  deadStock: false,
  performanceAnalytics: false,
  priorityQueue: false,
  prioritySupport: false,
};

export const PLAN_CATALOG: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    stripePriceIdEnv: null,
    limits: {
      aiListingsPerMonth: 10,
      autopublishesPerMonth: 10,
      compRefreshesPerMonth: 10,
      marketplaceConnections: 1,
      bulkBatchSize: 5,
      teamSeats: 1,
    },
    features: { ...NO_FEATURES },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2000,
    stripePriceIdEnv: "STRIPE_PRICE_PRO",
    limits: {
      aiListingsPerMonth: 125,
      autopublishesPerMonth: 125,
      compRefreshesPerMonth: 100,
      marketplaceConnections: 3,
      bulkBatchSize: 25,
      teamSeats: 1,
    },
    features: {
      ...NO_FEATURES,
      basicAnalytics: true,
      profitTracking: "simple",
      templates: true,
      assistedSoldDelist: true,
    },
  },
  kingpin: {
    id: "kingpin",
    name: "Kingpin",
    priceCents: 11900,
    stripePriceIdEnv: "STRIPE_PRICE_KINGPIN",
    limits: {
      aiListingsPerMonth: 1000,
      autopublishesPerMonth: 1000,
      compRefreshesPerMonth: 750,
      marketplaceConnections: 5,
      bulkBatchSize: 250,
      teamSeats: 5,
    },
    features: {
      basicAnalytics: true,
      profitTracking: "advanced",
      templates: true,
      assistedSoldDelist: true,
      fullInventorySync: true,
      autoDelist: true,
      soldDetection: true,
      advancedComps: true,
      advancedAnalytics: true,
      repricing: true,
      deadStock: true,
      performanceAnalytics: true,
      priorityQueue: true,
      prioritySupport: true,
    },
  },
};

export const PLAN_IDS = Object.keys(PLAN_CATALOG) as PlanId[];
export const PAID_PLAN_IDS: PlanId[] = ["pro", "kingpin"];

export function limitsFor(plan: PlanId): PlanLimits {
  return PLAN_CATALOG[plan].limits;
}

export function featuresFor(plan: PlanId): PlanFeatures {
  return PLAN_CATALOG[plan].features;
}

export function planForPriceId(
  priceId: string,
  env: Record<string, string | undefined> = process.env,
): PlanId | null {
  for (const plan of PAID_PLAN_IDS) {
    const key = PLAN_CATALOG[plan].stripePriceIdEnv;
    if (key && env[key] && env[key] === priceId) return plan;
  }
  return null;
}
```

- [ ] **Step 4: Run test, verify it passes** — `npx vitest run src/lib/billing/plans.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/billing/plans.ts src/lib/billing/plans.test.ts && git commit -m "feat(billing): plan catalog"`

### Task 0.2: Stripe config loader

**Files:**
- Create: `src/lib/billing/config.ts`
- Test: `src/lib/billing/config.test.ts`

**Interfaces:**
- Produces:
  - `interface StripeConfig { secretKey: string; webhookSecret: string; priceIds: Record<"pro" | "kingpin", string>; publishableKey: string | null }`
  - `function isBillingConfigured(env?): boolean` — true only when secret key, webhook secret, and both price ids are present and not bracket-masked.
  - `function loadStripeConfig(env?): StripeConfig` — throws `ConfigurationError` for the first missing var (reuses `getRequiredEnv` semantics: a value that is empty or contains `[` is treated as missing, matching the existing masked-secret convention).

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { isBillingConfigured, loadStripeConfig } from "./config";

const full = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_KINGPIN: "price_king",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
};

describe("stripe config", () => {
  it("reports configured only when complete", () => {
    expect(isBillingConfigured(full)).toBe(true);
    expect(isBillingConfigured({ ...full, STRIPE_PRICE_KINGPIN: "" })).toBe(false);
    expect(isBillingConfigured({})).toBe(false);
  });

  it("treats bracket-masked vars as missing", () => {
    expect(isBillingConfigured({ ...full, STRIPE_SECRET_KEY: "[redacted]" })).toBe(false);
  });

  it("loads a typed config", () => {
    const cfg = loadStripeConfig(full);
    expect(cfg.priceIds.pro).toBe("price_pro");
    expect(cfg.priceIds.kingpin).toBe("price_king");
    expect(cfg.publishableKey).toBe("pk_test_123");
  });

  it("throws when a required var is absent", () => {
    expect(() => loadStripeConfig({})).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```ts
import { ConfigurationError } from "@/lib/errors";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: Record<"pro" | "kingpin", string>;
  publishableKey: string | null;
}

type Env = Record<string, string | undefined>;

function present(value: string | undefined): value is string {
  return !!value && !value.includes("[");
}

const REQUIRED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_KINGPIN",
] as const;

export function isBillingConfigured(env: Env = process.env): boolean {
  return REQUIRED.every((key) => present(env[key]));
}

function require(env: Env, key: string): string {
  const value = env[key];
  if (!present(value)) throw new ConfigurationError(key);
  return value;
}

export function loadStripeConfig(env: Env = process.env): StripeConfig {
  return {
    secretKey: require(env, "STRIPE_SECRET_KEY"),
    webhookSecret: require(env, "STRIPE_WEBHOOK_SECRET"),
    priceIds: {
      pro: require(env, "STRIPE_PRICE_PRO"),
      kingpin: require(env, "STRIPE_PRICE_KINGPIN"),
    },
    publishableKey: present(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
      ? env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      : null,
  };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): stripe config loader"`

### Task 0.3: Add the Stripe SDK + client singleton

**Files:**
- Modify: `package.json` (add `stripe` dependency)
- Create: `src/lib/billing/stripe.ts`

**Interfaces:**
- Produces: `function getStripe(env?): Stripe` — memoized singleton bound to the test secret key, `apiVersion` pinned.

- [ ] **Step 1: Install** — `npm install stripe` (pin the version it resolves; record it). Run `npm ls stripe` to confirm.
- [ ] **Step 2: Implement**

```ts
import "server-only";
import Stripe from "stripe";
import { loadStripeConfig } from "./config";

let client: Stripe | null = null;

export function getStripe(env = process.env): Stripe {
  if (client) return client;
  const { secretKey } = loadStripeConfig(env);
  client = new Stripe(secretKey, { apiVersion: "2025-05-28.basil" });
  return client;
}
```

(Use the `apiVersion` the installed SDK's types expect; adjust the literal to match or omit to take the SDK default. Do not log the key.)

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → no errors in this file.
- [ ] **Step 4: Commit** — `git commit -m "feat(billing): stripe sdk client singleton"`

### Task 0.4: Test-mode products and prices (operator step + idempotent script)

**Files:**
- Create: `scripts/stripe/sync-products.ts`

This task provisions Stripe and is run by an operator with the **test** secret key in the environment, not in CI.

- [ ] **Step 1: Implement the idempotent sync script** — looks up products by a stable `metadata.sello_plan` tag, creates them if missing, creates a monthly recurring price for each (`pro` = 2000, `kingpin` = 11900, currency `usd`), and prints the resulting price ids to copy into env. Reuses `getStripe()` and `PLAN_CATALOG`. The script must be re-runnable without creating duplicates (search before create; never delete).
- [ ] **Step 2: Run it in test mode** — `STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe/sync-products.ts`. Copy `STRIPE_PRICE_PRO` / `STRIPE_PRICE_KINGPIN` into `.env.local` (and Vercel test env later, when asked).
- [ ] **Step 3: Commit the script** — `git commit -m "chore(billing): idempotent stripe product sync script"`

> Operator note: set `.env.local` with `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` (from the Stripe CLI listener, Task 1.5), `STRIPE_PRICE_PRO`, `STRIPE_PRICE_KINGPIN`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test). Never commit `.env.local`.

**Phase 0 gate:** `npm run lint && npm test && npx prisma validate && npm run build`.

---

## Phase 1 — Billing core / working paywall

### Task 1.1: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma` (append enums + models)
- Create: migration via `npx prisma migrate dev --name billing_models`
- Test: `prisma/migrations/billing-models.test.ts`

**Interfaces:**
- Produces tables `Account`, `AccountMember`, `Subscription`, `UsageCounter`, `StripeEvent` and enums `PlanTier`, `MemberRole`, `MemberStatus`, `SubscriptionStatus`, `UsageMetric`.

- [ ] **Step 1: Append schema**

```prisma
enum PlanTier {
  free
  pro
  kingpin
}

enum MemberRole {
  owner
  admin
  member
}

enum MemberStatus {
  active
  invited
  revoked
}

enum SubscriptionStatus {
  active
  trialing
  past_due
  canceled
  incomplete
  incomplete_expired
  unpaid
}

enum UsageMetric {
  ai_listing
  autopublish
  comp_refresh
}

model Account {
  id           String         @id @default(uuid()) @db.Uuid
  ownerUserId  String         @unique @db.Uuid
  plan         PlanTier       @default(free)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  members      AccountMember[]
  subscription Subscription?
  usage        UsageCounter[]
}

model AccountMember {
  id           String       @id @default(uuid()) @db.Uuid
  accountId    String       @db.Uuid
  userId       String?      @db.Uuid
  invitedEmail String?
  role         MemberRole   @default(member)
  status       MemberStatus @default(invited)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  account      Account      @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, userId])
  @@index([userId])
  @@index([accountId, status])
}

model Subscription {
  id                   String             @id @default(uuid()) @db.Uuid
  accountId            String             @unique @db.Uuid
  stripeCustomerId     String             @unique
  stripeSubscriptionId String?            @unique
  plan                 PlanTier           @default(free)
  status               SubscriptionStatus @default(active)
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean            @default(false)
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  account              Account            @relation(fields: [accountId], references: [id], onDelete: Cascade)
}

model UsageCounter {
  id          String      @id @default(uuid()) @db.Uuid
  accountId   String      @db.Uuid
  metric      UsageMetric
  periodStart DateTime    @db.Date
  count       Int         @default(0)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  account     Account     @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, metric, periodStart])
  @@index([accountId, periodStart])
}

model StripeEvent {
  id          String   @id
  type        String
  processedAt DateTime @default(now())
}
```

- [ ] **Step 2: Validate + generate** — `npx prisma validate` then `npx prisma migrate dev --name billing_models` (against the dev/preview DB; reviewed through `develop`). Confirm `src/generated/prisma` regenerates.
- [ ] **Step 3: Static migration test** (mirror `prisma/migrations/*.test.ts`) — assert the new `migration.sql` creates the five tables and the unique indexes (`Account_ownerUserId_key`, `Subscription_accountId_key`, `UsageCounter_accountId_metric_periodStart_key`) and does **not** contain `ROW LEVEL SECURITY`.
- [ ] **Step 4: Run** — `npx vitest run prisma/migrations/billing-models.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): account, subscription, usage, stripe-event models"`

### Task 1.2: Account resolver

**Files:**
- Create: `src/lib/billing/account.ts`
- Test: `src/lib/billing/account.test.ts`

**Interfaces:**
- Consumes: `getPrisma()`, `PlanTier`.
- Produces:
  - `type AccountRecord = { id: string; ownerUserId: string; plan: PlanId }`
  - `async function getOrCreateAccount(userId: string, prisma?): Promise<AccountRecord>` — finds the account by `ownerUserId`; if absent, creates it plus the owner `AccountMember` (role `owner`, status `active`) in a transaction.
  - `async function getActiveAccount(userId: string, prisma?): Promise<AccountRecord>` — Phase 1: the account where `ownerUserId = userId`. (Phase 4 widens this to membership.)

- [ ] **Step 1: Failing test** — mock `getPrisma`; assert `getOrCreateAccount` creates account + owner member when none exists, and returns the existing one when present (no duplicate create).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** using a `prisma.$transaction` create of `Account` + `AccountMember{ role: "owner", status: "active", userId }`; map `plan` enum to `PlanId`.
- [ ] **Step 4: Run, pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): account resolver"`

### Task 1.3: Stripe customer + checkout route

**Files:**
- Create: `src/lib/billing/customer.ts` (`ensureStripeCustomer(account, userEmail, prisma?)`)
- Create: `src/app/api/billing/checkout/route.ts`
- Test: `src/app/api/billing/checkout/route.test.ts`

**Interfaces:**
- Consumes: `requireSupabaseUser`, `getActiveAccount`, `getStripe`, `loadStripeConfig`, `PLAN_CATALOG`.
- Produces: `POST` accepting `{ plan: "pro" | "kingpin" }` (Zod-validated), returns `{ url }` for the Checkout Session.

Behavior: resolve user → account; `ensureStripeCustomer` (find-or-create Stripe customer, persist `Subscription.stripeCustomerId` row if absent, idempotent on the unique `accountId`); create Checkout Session `mode: "subscription"`, `line_items: [{ price, quantity: 1 }]`, `client_reference_id: account.id`, `customer`, `success_url`/`cancel_url` from request origin → `/settings/billing?status=success` and `/pricing`. Reject `free` with `AppError(400, "FREE_PLAN_NOT_CHECKOUT")`. Respond via `safeErrorResponse` on throw.

- [ ] **Step 1: Failing test** — mock stripe + prisma + auth; assert a pro checkout returns the session url and passes `client_reference_id = account.id`; assert `free` is rejected 400; assert unauthenticated → 401.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement route + `customer.ts`.**
- [ ] **Step 4: Run, pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): checkout session route"`

### Task 1.4: Customer Portal route

**Files:**
- Create: `src/app/api/billing/portal/route.ts`
- Test: `src/app/api/billing/portal/route.test.ts`

**Interfaces:** `POST` → resolve user → account → `Subscription.stripeCustomerId`; create Billing Portal session with `return_url = origin + /settings/billing`; return `{ url }`. If no customer yet, `AppError(409, "NO_BILLING_CUSTOMER")`.

- [ ] **Step 1: Failing test** — returns portal url for an account with a customer; 409 when none; 401 unauthenticated.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(billing): customer portal route"`

### Task 1.5: Webhook handler (pure) + route

**Files:**
- Create: `src/lib/billing/webhook.ts`
- Create: `src/app/api/billing/webhook/route.ts`
- Test: `src/lib/billing/webhook.test.ts`

**Interfaces:**
- Produces:
  - `async function handleStripeEvent(event: Stripe.Event, prisma): Promise<void>` — idempotent (first inserts `StripeEvent` by id; if it already exists, returns early). Handles:
    - `checkout.session.completed` → read `client_reference_id` (accountId), `subscription` id; load the subscription from Stripe (or use the expanded object) → upsert `Subscription` (plan via `planForPriceId`, status, period bounds, `stripeSubscriptionId`) and set `Account.plan`.
    - `customer.subscription.updated` / `.created` → upsert by `stripeCustomerId`: plan, status, `currentPeriodStart/End`, `cancelAtPeriodEnd`, `Account.plan`.
    - `customer.subscription.deleted` → set `Subscription.status = canceled`, `Subscription.plan = free`, `Account.plan = free`.
    - `invoice.payment_failed` → set `Subscription.status = past_due` (no plan change).
  - Unknown event types: no-op (still recorded as processed).

- [ ] **Step 1: Failing tests** — fixture `Stripe.Event` objects (typed literals) for each handled type; assert the resulting prisma writes via a mocked prisma; assert a second call with the same event id is a no-op (idempotency).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement `handleStripeEvent`.**
- [ ] **Step 4: Implement the route** — `runtime = "nodejs"`; read `await request.text()` raw body; `getStripe().webhooks.constructEvent(body, sig, webhookSecret)`; on signature failure return 400; else `handleStripeEvent`; return 200 `{ received: true }`. Never log the body.
- [ ] **Step 5: Run, pass.**
- [ ] **Step 6: Commit** — `git commit -m "feat(billing): idempotent stripe webhook handler + route"`

### Task 1.6: Default-account wiring + manual test-mode verification

**Files:**
- Modify: `src/app/(app)/layout.tsx` (call `getOrCreateAccount(user.id)` so every authenticated user has an account; do not block render on Stripe).

- [ ] **Step 1:** Ensure the app layout (already loads the user + feature access) calls `getOrCreateAccount`. Add a focused test if the layout has one, else cover via `account.test.ts`.
- [ ] **Step 2: Manual e2e (operator, test mode)** — run `stripe listen --forward-to localhost:3000/api/billing/webhook` (gives `STRIPE_WEBHOOK_SECRET`), `npm run dev`, hit checkout for Pro with test card `4242 4242 4242 4242`, confirm `Subscription` row + `Account.plan = pro`; cancel via portal, confirm downgrade. Use the `stripe:test-cards` skill for scenarios.
- [ ] **Step 3: Commit** — `git commit -m "feat(billing): ensure account on authenticated load"`

**Phase 1 gate:** `npm run lint && npm test && npx prisma validate && npm run build`.

---

## Phase 2 — Entitlements + metering enforcement

### Task 2.1: Billing errors

**Files:** Create `src/lib/billing/errors.ts`; Test `src/lib/billing/errors.test.ts`.

**Interfaces:** `quotaExceeded(metric): AppError` (402, `QUOTA_EXCEEDED_AI_LISTING` etc.), `planFeatureRequired(feature): AppError` (403, `PLAN_FEATURE_REQUIRED`), `connectionLimitReached(limit): AppError` (403, `CONNECTION_LIMIT_REACHED`), `bulkBatchTooLarge(limit): AppError` (400, `BULK_BATCH_TOO_LARGE`). Copy is seller-facing, no em dashes.

- [ ] Steps: failing test asserting codes/status/message → implement → pass → commit.

### Task 2.2: Entitlements resolver

**Files:** Create `src/lib/billing/entitlements.ts`; Test `src/lib/billing/entitlements.test.ts`.

**Interfaces:**
- Consumes: `getActiveAccount`, `featuresFor`, `limitsFor`, `planFeatureRequired`.
- Produces:
  - `interface Entitlements { plan: PlanId; limits: PlanLimits; features: PlanFeatures }`
  - `function entitlementsForPlan(plan: PlanId): Entitlements` (pure)
  - `async function getEntitlements(userId, prisma?): Promise<Entitlements>`
  - `function requirePlanFeature(ent: Entitlements, feature: FeatureFlag): void` (throws `planFeatureRequired` when the flag is falsey/`"none"`).

- [ ] Steps: failing test (`entitlementsForPlan("kingpin").features.autoDelist === true`; `requirePlanFeature` throws on free for `fullInventorySync`) → implement → pass → commit.

### Task 2.3: Usage metering primitives

**Files:** Create `src/lib/billing/usage.ts`; Test `src/lib/billing/usage.test.ts`.

**Interfaces:**
- Produces:
  - `function billingPeriodStart(now: Date, sub: { currentPeriodStart: Date | null } | null): Date` — subscription `currentPeriodStart` (date-floored, UTC) when present, else first of the current calendar month (UTC). Pure.
  - `async function getUsage(accountId, metric, now, prisma?): Promise<number>`
  - `async function assertWithinQuota(account: { id; plan }, metric: UsageMetricKey, now, prisma?): Promise<void>` — throws `quotaExceeded(metric)` when `count >= limit`. Maps metric → limit via `limitsFor`.
  - `async function incrementUsage(accountId, metric, now, n=1, prisma?): Promise<void>` — atomic upsert on `(accountId, metric, periodStart)` with `increment`.
  - `type UsageMetricKey = "ai_listing" | "autopublish" | "comp_refresh"` and a metric→limit-field map.

- [ ] Steps: failing tests for `billingPeriodStart` (calendar-month fallback; subscription-cycle path), `assertWithinQuota` boundary (passes at count=limit-1, throws at count=limit), `incrementUsage` upsert path (mock prisma) → implement → pass → commit.

### Task 2.4: Enforce AI-listing quota

**Files:** Modify `src/app/api/listings/draft/route.ts`; extend its test.

- [ ] **Step 1:** In the draft generation handler, after `requireSupabaseUser`, resolve `getActiveAccount(user.id)`, call `assertWithinQuota(account, "ai_listing", new Date())` **before** the Gemini call; call `incrementUsage(account.id, "ai_listing", new Date())` **only after** a successful draft is produced.
- [ ] **Step 2:** Add a route test: at the limit, returns 402 `QUOTA_EXCEEDED_AI_LISTING` and does not call Gemini; below the limit, proceeds and increments once.
- [ ] **Step 3:** Run, pass. Commit.

### Task 2.5: Enforce autopublish quota + bulk batch cap

**Files:** Modify `src/app/api/listings/publish/route.ts`, `.../publish/bulk/route.ts`; extend tests.

- [ ] **Step 1:** Single publish: `assertWithinQuota(account, "autopublish")` before publish; `incrementUsage(..., 1)` on success.
- [ ] **Step 2:** Bulk publish: replace the hardcoded `maxItemsPerRequest` ceiling with `limitsFor(account.plan).bulkBatchSize` (`bulkBatchTooLarge` when exceeded); `assertWithinQuota` reserving `itemIds.length`; increment by the count actually published (successful items only).
- [ ] **Step 3:** Tests: free plan rejects a 6-item bulk (`BULK_BATCH_TOO_LARGE`); pro rejects 26; autopublish over quota → 402; increments match successes.
- [ ] **Step 4:** Run, pass. Commit.

### Task 2.6: Enforce comp-refresh quota

**Files:** Modify `src/app/api/listings/comps/route.ts` (the refresh path); extend test.

- [ ] **Step 1:** On a refresh request, `assertWithinQuota(account, "comp_refresh")` before the fetch; `incrementUsage` on a successful refresh. (Reads of existing comps are not metered, only refreshes.)
- [ ] **Step 2:** Test: at limit → 402 `QUOTA_EXCEEDED_COMP_REFRESH`; below → proceeds, increments once. Run, pass. Commit.

### Task 2.7: Marketplace connection cap

**Files:** Modify the marketplace connect entrypoints (e.g. `src/app/api/marketplaces/etsy/connect/route.ts` and the eBay connect flow); add/extend tests.

- [ ] **Step 1:** Before establishing a new connection, count active `MarketplaceConnection` rows for the account; if `>= limitsFor(plan).marketplaceConnections`, throw `connectionLimitReached(limit)`. (Reconnecting an existing marketplace is not a new connection.)
- [ ] **Step 2:** Test: free (limit 1) blocks a second distinct marketplace; pro allows up to 3. Run, pass. Commit.

**Phase 2 gate:** full gate.

---

## Phase 3 — Pricing page + billing UI

### Task 3.1: Usage snapshot endpoint

**Files:** Create `src/app/api/billing/usage/route.ts`; Test alongside.

**Interfaces:** `GET` → `{ plan, limits, usage: { ai_listing, autopublish, comp_refresh }, periodStart, periodEnd, status, cancelAtPeriodEnd }` for the authed user's account. Pure assembly over `getEntitlements` + `getUsage`.

- [ ] Steps: failing test (shape + values) → implement → pass → commit.

### Task 3.2: Public pricing page

**Files:** Create `src/app/pricing/page.tsx`, `src/components/billing/plan-cards.tsx`; Test the card component.

- [ ] **Step 1:** Server component renders three `plan-cards` from `PLAN_CATALOG` (name, price, the limit/feature bullets). CTAs: Free → sign up; Pro/Kingpin → POST `/api/billing/checkout` then redirect to `url` (client component for the button). Clear states; Tailwind; no em dashes in copy.
- [ ] **Step 2:** Component test: renders all three plans and the correct prices ($0/$20/$119). Run, pass. Commit.

### Task 3.3: Billing settings page + meters

**Files:** Create `src/app/(app)/settings/billing/page.tsx`, `src/components/billing/usage-meter.tsx`, `src/components/billing/upgrade-cta.tsx`; tests for the components.

- [ ] **Step 1:** Server component fetches the usage snapshot; shows current plan, status, renewal date, a `usage-meter` per metric (count/limit with a bar), "Manage billing" button → POST `/api/billing/portal` → redirect, and upgrade/downgrade buttons → checkout/portal.
- [ ] **Step 2:** `upgrade-cta` is a shared banner/modal the app shows when an API returns a `QUOTA_EXCEEDED_*` / `PLAN_FEATURE_REQUIRED` code (wire into the existing client API error handling in `src/lib/api/client.ts`).
- [ ] **Step 3:** Component tests: meter renders `7 / 10` and a near-full state; cta renders the upgrade link. Run, pass. Commit.

**Phase 3 gate:** full gate. After this phase, do a supervised manual pass in test mode (subscribe, hit a wall, upgrade, see meters update).

---

## Phase 4 — Team seats (shared workspace, application layer only)

> RLS untouched (Global Constraints). This phase changes app-layer scoping only. It is the heaviest phase and is reviewed in its own PR.

### Task 4.1: Membership model usage + invites

**Files:** Create `src/lib/billing/membership.ts`; routes `src/app/api/account/members/route.ts` (list, invite), `.../members/[id]/route.ts` (revoke), `.../members/accept/route.ts`; tests.

**Interfaces:**
- `async function accountMemberIds(accountId, prisma?): Promise<string[]>` — active member `userId`s.
- `async function getActiveAccount(userId)` widened: account where the user is an **active member** (owner first), fallback to `getOrCreateAccount` for users with none.
- `async function inviteMember(account, email, role, prisma?)` — enforces `seatCount < limitsFor(plan).teamSeats`; creates an `invited` member row keyed by `invitedEmail`.
- `async function acceptInvite(userId, email, prisma?)` — binds `userId` to the matching `invited` row, sets `status = active`.
- `async function revokeMember(account, memberId, prisma?)` — sets `status = revoked`.

- [ ] Steps: failing tests (seat-limit blocks the 6th Kingpin invite; non-Kingpin limited to 1; accept binds userId; revoke flips status) → implement → pass → commit. Then wire `acceptInvite` into the post-login flow.

### Task 4.2: Account-scope helper + data migration

**Files:** Modify `prisma/schema.prisma` (add `accountId String? @db.Uuid` + index to `InventoryItem`, `MarketplaceConnection`, `EbaySellerConfig`, and the other root-owned tables); migration `add_account_scope` with a data backfill (`UPDATE ... SET "accountId" = (owner's account)`); then a follow-up migration making `accountId` non-null once backfilled. Create `src/lib/billing/scope.ts` (`sellerScope(account): { accountId: string }` and a read helper resolving to `{ accountId: { in: [...] } }` or member-id set as chosen).

- [ ] Steps: add nullable column + backfill migration (static migration test asserting backfill SQL, no RLS) → generate → switch app-layer reads/writes to account scope behind `sellerScope` → tighten to non-null. Commit per sub-step.

### Task 4.3: Migrate seller-scoped queries to account scope

**Files:** Modify every route/query currently filtering by `sellerId`/`userId` for seller data (inventory, listings, drafts, comps, history, publish, marketplaces). Replace `where: { sellerId: user.id }` with account-scoped filters via `sellerScope`. Writes stamp `accountId` + acting `userId`.

- [ ] Steps: do this in reviewable batches by area (inventory, listings, marketplaces). For each: update queries, update/extend tests to assert a second member of the same account sees the owner's items and a non-member does not. Run the gate per batch. Commit per batch.

**Phase 4 gate:** full gate + the cross-member access tests.

---

## Self-Review

**Spec coverage:** Plan catalog (Task 0.1), Stripe config/SDK/products (0.2–0.4), data model (1.1), account (1.2), checkout (1.3), portal (1.4), webhooks (1.5), default account (1.6), entitlements (2.2), metering + all enforcement points (2.3–2.7), two-gate model (entitlements layered beside the untouched `feature-access.ts`), pricing page (3.2), billing settings + meters + quota walls (3.1, 3.3), seats (4.1–4.3). RLS explicitly excluded per the spec. No spec requirement left unmapped.

**Placeholders:** Phase 0–2 carry complete code or precise behavior with exact signatures. Phases 3–4 specify file paths, interfaces, and acceptance per task; their UI/migration bodies are described at step level with concrete test assertions (acceptable for an executing agent; expand each into red/green/commit during execution).

**Type consistency:** `PlanId` ("free"|"pro"|"kingpin") and the `PlanTier` enum are kept distinct (DB enum vs app union) and mapped explicitly. `UsageMetric` (DB) vs `UsageMetricKey` (app) named consistently. `getActiveAccount` signature is introduced in 1.2 and explicitly widened in 4.1 (noted at both sites). Stripe price ids flow env → `loadStripeConfig` → `planForPriceId` consistently.
