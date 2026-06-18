import { NextResponse } from "next/server";

import { utcDayStart, utcMonthStart } from "@/lib/comps/provider-budget";
import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Seller-scoped paid-provider usage log (the "admin/log view"): recent paid comp
// calls with provider, status, skipped reason, estimated cost, and result counts,
// plus today's/this month's call + spend totals. Every query is scoped to the
// authenticated user; one seller can never see another's usage. No secrets here.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const now = new Date();
    const dayStart = utcDayStart(now);
    const monthStart = utcMonthStart(now);

    const [rows, todaySpend, todayCalls, monthCalls] = await Promise.all([
      prisma.providerCallLedger.findMany({
        where: { userId: user.id },
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
        where: { userId: user.id, createdAt: { gte: dayStart } },
      }),
      prisma.providerCallLedger.count({
        where: {
          userId: user.id,
          createdAt: { gte: dayStart },
          status: { in: ["attempted", "succeeded", "failed"] },
        },
      }),
      prisma.providerCallLedger.count({
        where: {
          userId: user.id,
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
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
