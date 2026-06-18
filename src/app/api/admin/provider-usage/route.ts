import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/auth/admin";
import { isCompsPaidProvidersEnabled } from "@/lib/comps/flags";
import { utcDayStart, utcMonthStart } from "@/lib/comps/provider-budget";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

const COSTING = ["attempted", "succeeded", "failed"];

function isMissingTable(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  return code === "P2021" || code === "42P01";
}

// Owner/admin only: aggregate paid-provider usage across all sellers (the seller-
// scoped /api/listings/comps/provider-usage stays the per-user view). No secrets
// are stored in the ledger, so nothing token-like can be returned.
export async function GET(request: Request) {
  try {
    await requireAdminUser(request);
    const prisma = getPrisma();
    const now = new Date();
    const dayStart = utcDayStart(now);
    const monthStart = utcMonthStart(now);

    try {
      const [rows, todaySpend, monthSpend, todayCalls, monthCalls, todaySkipped, todayFailures] =
        await Promise.all([
          prisma.providerCallLedger.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              userId: true,
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
            where: { createdAt: { gte: dayStart } },
          }),
          prisma.providerCallLedger.aggregate({
            _sum: { estimatedCostCents: true },
            where: { createdAt: { gte: monthStart } },
          }),
          prisma.providerCallLedger.count({
            where: { createdAt: { gte: dayStart }, status: { in: COSTING as never } },
          }),
          prisma.providerCallLedger.count({
            where: { createdAt: { gte: monthStart }, status: { in: COSTING as never } },
          }),
          prisma.providerCallLedger.count({
            where: { createdAt: { gte: dayStart }, status: "skipped" },
          }),
          prisma.providerCallLedger.count({
            where: { createdAt: { gte: dayStart }, status: "failed" },
          }),
        ]);

      return NextResponse.json({
        paidProvidersEnabled: isCompsPaidProvidersEnabled(),
        totals: {
          todaySpendCents: todaySpend._sum.estimatedCostCents ?? 0,
          monthSpendCents: monthSpend._sum.estimatedCostCents ?? 0,
          todayCalls,
          monthCalls,
          todaySkipped,
          todayFailures,
        },
        rows,
      });
    } catch (dbError) {
      if (isMissingTable(dbError)) {
        return NextResponse.json(
          {
            error:
              "Provider usage ledger is not available yet. Apply the ProviderCallLedger migration.",
          },
          { status: 503 },
        );
      }
      throw dbError;
    }
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("admin_provider_usage_fetch_failed");
    return NextResponse.json(
      { error: "admin_provider_usage_fetch_failed" },
      { status: 500 },
    );
  }
}
