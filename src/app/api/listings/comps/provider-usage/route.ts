import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { accountMemberIds } from "@/lib/billing/membership";
import { utcDayStart, utcMonthStart } from "@/lib/comps/provider-budget";
import { AppError, safeClientMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Account-scoped paid-provider usage log (the "admin/log view"): recent paid comp
// calls with provider, status, skipped reason, estimated cost, and result counts,
// plus today's/this month's call + spend totals. Every query is scoped to the
// active account's current members; revoked/unrelated users are excluded. No
// secrets here.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const memberIds = await accountMemberIds(account.id, prisma);
    const now = new Date();
    const dayStart = utcDayStart(now);
    const monthStart = utcMonthStart(now);

    const [rows, todaySpend, todayCalls, monthCalls] = await Promise.all([
      prisma.providerCallLedger.findMany({
        where: { userId: { in: memberIds } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          provider: true,
          status: true,
          skippedReason: true,
          estimatedCostCents: true,
          fetchedCount: true,
          acceptedCount: true,
          rejectedCount: true,
          draftId: true,
          inventoryItemId: true,
          createdAt: true,
        },
      }),
      prisma.providerCallLedger.aggregate({
        _sum: { estimatedCostCents: true },
        where: { userId: { in: memberIds }, createdAt: { gte: dayStart } },
      }),
      prisma.providerCallLedger.count({
        where: {
          userId: { in: memberIds },
          createdAt: { gte: dayStart },
          status: { in: ["attempted", "succeeded", "failed"] },
        },
      }),
      prisma.providerCallLedger.count({
        where: {
          userId: { in: memberIds },
          createdAt: { gte: monthStart },
          status: { in: ["attempted", "succeeded", "failed"] },
        },
      }),
    ]);

    return NextResponse.json({
      rows,
      totals: {
        todaySpendCents: todaySpend._sum.estimatedCostCents ?? 0,
        todayCalls,
        monthCalls,
      },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "provider_usage" }) },
      { status },
    );
  }
}
