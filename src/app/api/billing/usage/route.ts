import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { entitlementsForPlan } from "@/lib/billing/entitlements";
import { billingPeriodStart } from "@/lib/billing/usage";
import { safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
import type { UsageMetricKey } from "@/lib/billing/errors";

export const runtime = "nodejs";

const USAGE_METRICS = ["ai_listing", "autopublish", "comp_refresh"] as const;
type BillingUsage = Record<(typeof USAGE_METRICS)[number], number>;

// Usage + plan snapshot for the billing settings UI: the current plan, its
// limits/features, this period's usage counts, and the subscription status.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const entitlements = entitlementsForPlan(account.plan);
    const now = new Date();
    const subscription = await prisma.subscription.findUnique({
      where: { accountId: account.id },
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });

    const periodStart = billingPeriodStart(now, subscription);
    const usageRows = await prisma.usageCounter.findMany({
      where: {
        accountId: account.id,
        periodStart,
        metric: { in: [...USAGE_METRICS] },
      },
      select: { metric: true, count: true },
    });
    const usage: BillingUsage = { ai_listing: 0, autopublish: 0, comp_refresh: 0 };
    for (const row of usageRows) {
      if (USAGE_METRICS.includes(row.metric as UsageMetricKey)) {
        usage[row.metric as keyof BillingUsage] = row.count;
      }
    }

    const periodEnd =
      subscription?.currentPeriodEnd ??
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    return NextResponse.json({
      plan: account.plan,
      limits: entitlements.limits,
      features: entitlements.features,
      usage,
      periodStart,
      periodEnd,
      status: subscription?.status ?? "active",
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "billing_usage",
      fallbackCode: "BILLING_USAGE_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
