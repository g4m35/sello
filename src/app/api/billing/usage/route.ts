import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { entitlementsForPlan } from "@/lib/billing/entitlements";
import { billingPeriodStart, getUsage } from "@/lib/billing/usage";
import { safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Usage + plan snapshot for the billing settings UI: the current plan, its
// limits/features, this period's usage counts, and the subscription status.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const account = await getActiveAccount(user.id);
    const entitlements = entitlementsForPlan(account.plan);
    const now = new Date();

    const [aiListing, autopublish, compRefresh] = await Promise.all([
      getUsage(account.id, "ai_listing", now),
      getUsage(account.id, "autopublish", now),
      getUsage(account.id, "comp_refresh", now),
    ]);

    const subscription = await getPrisma().subscription.findUnique({
      where: { accountId: account.id },
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });

    const periodStart = billingPeriodStart(now, subscription);
    const periodEnd =
      subscription?.currentPeriodEnd ??
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    return NextResponse.json({
      plan: account.plan,
      limits: entitlements.limits,
      features: entitlements.features,
      usage: { ai_listing: aiListing, autopublish, comp_refresh: compRefresh },
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
