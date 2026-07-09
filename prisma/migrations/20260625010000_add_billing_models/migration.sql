-- Billing models: accounts, team members, subscriptions, usage counters, and a
-- Stripe webhook idempotency ledger. Additive only; no existing table or row is
-- changed. Account owns the subscription and usage so billing/metering are
-- account-keyed from day one. RLS is enabled with no policy on every new table,
-- matching this schema's uniform deny-all posture (the trusted resale_app role
-- bypasses RLS; the browser never queries these tables).

CREATE TYPE "PlanTier" AS ENUM ('free', 'pro', 'kingpin');
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "MemberStatus" AS ENUM ('active', 'invited', 'revoked');
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid');
CREATE TYPE "UsageMetric" AS ENUM ('ai_listing', 'autopublish', 'comp_refresh');

CREATE TABLE "Account" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ownerUserId" UUID NOT NULL,
  "plan" "PlanTier" NOT NULL DEFAULT 'free',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountMember" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "userId" UUID,
  "invitedEmail" TEXT,
  "role" "MemberRole" NOT NULL DEFAULT 'member',
  "status" "MemberStatus" NOT NULL DEFAULT 'invited',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AccountMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT,
  "plan" "PlanTier" NOT NULL DEFAULT 'free',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageCounter" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "periodStart" DATE NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StripeEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Account_ownerUserId_key" ON "Account"("ownerUserId");
CREATE INDEX "AccountMember_userId_idx" ON "AccountMember"("userId");
CREATE INDEX "AccountMember_accountId_status_idx" ON "AccountMember"("accountId", "status");
CREATE UNIQUE INDEX "AccountMember_accountId_userId_key" ON "AccountMember"("accountId", "userId");
CREATE UNIQUE INDEX "Subscription_accountId_key" ON "Subscription"("accountId");
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX "UsageCounter_accountId_periodStart_idx" ON "UsageCounter"("accountId", "periodStart");
CREATE UNIQUE INDEX "UsageCounter_accountId_metric_periodStart_key" ON "UsageCounter"("accountId", "metric", "periodStart");

ALTER TABLE "AccountMember" ADD CONSTRAINT "AccountMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uniform deny-all posture: enable RLS, define no policy. resale_app bypasses.
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StripeEvent" ENABLE ROW LEVEL SECURITY;
