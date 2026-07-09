import "server-only";

import { isAdminUser } from "@/lib/auth/admin";
import { getPrisma } from "@/lib/prisma";

import { quotaExceeded, type UsageMetricKey } from "./errors";
import { limitsFor, type PlanId, type PlanLimits } from "./plans";

type Db = ReturnType<typeof getPrisma>;

const METRIC_LIMIT_FIELD: Record<UsageMetricKey, keyof PlanLimits> = {
  ai_listing: "aiListingsPerMonth",
  autopublish: "autopublishesPerMonth",
  comp_refresh: "compRefreshesPerMonth",
};

type QuotaUser = { id?: string | null; email?: string | null };

// Start of the current usage period (UTC midnight), used as the counter key.
// Tracks the subscription billing cycle when there is one, otherwise the
// calendar month, so counters reset in step with what the customer pays for.
export function billingPeriodStart(
  now: Date,
  subscription: { currentPeriodStart: Date | null } | null,
): Date {
  const anchor = subscription?.currentPeriodStart;
  if (anchor) {
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function resolvePeriodStart(accountId: string, now: Date, prisma: Db): Promise<Date> {
  const subscription = await prisma.subscription.findUnique({
    where: { accountId },
    select: { currentPeriodStart: true },
  });
  return billingPeriodStart(now, subscription);
}

export async function getUsage(
  accountId: string,
  metric: UsageMetricKey,
  now: Date,
  prisma: Db = getPrisma(),
): Promise<number> {
  const periodStart = await resolvePeriodStart(accountId, now, prisma);
  const row = await prisma.usageCounter.findUnique({
    where: { accountId_metric_periodStart: { accountId, metric, periodStart } },
  });
  return row?.count ?? 0;
}

// Throws QUOTA_EXCEEDED_* when the account has reached its plan's monthly limit
// for the metric. Call BEFORE doing the metered work. Admins are never quota-
// gated (owner testing); pass `user` so the identity check can run.
export async function assertWithinQuota(
  account: { id: string; plan: PlanId },
  metric: UsageMetricKey,
  now: Date,
  opts?: { prisma?: Db; user?: QuotaUser },
): Promise<void> {
  if (opts?.user && isAdminUser(opts.user)) return;
  const prisma = opts?.prisma ?? getPrisma();
  const limit = limitsFor(account.plan)[METRIC_LIMIT_FIELD[metric]];
  const used = await getUsage(account.id, metric, now, prisma);
  if (used >= limit) throw quotaExceeded(metric);
}

// Atomically records `n` units of usage for the current period. Call AFTER the
// metered work succeeds so failures never burn quota.
export async function incrementUsage(
  accountId: string,
  metric: UsageMetricKey,
  now: Date,
  n = 1,
  prisma: Db = getPrisma(),
): Promise<void> {
  const periodStart = await resolvePeriodStart(accountId, now, prisma);
  await prisma.usageCounter.upsert({
    where: { accountId_metric_periodStart: { accountId, metric, periodStart } },
    create: { accountId, metric, periodStart, count: n },
    update: { count: { increment: n } },
  });
}
