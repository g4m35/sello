import { createHash } from "node:crypto";

import {
  utcDayStart,
  utcMonthStart,
  type PaidGateUsage,
  type PaidProviderSkipReason,
} from "@/lib/comps/provider-budget";

// Persistence for the paid-provider call ledger. The usage loader computes the
// counts the budget gate needs (global daily spend, per-user daily/monthly call
// counts, last paid call for a draft); the recorder writes one immutable row per
// call attempt/skip. Only "real" calls (attempted/succeeded/failed) count toward
// budget/quota — skipped rows are free.

const COSTING_STATUSES = ["attempted", "succeeded", "failed"] as const;

export type ProviderCallStatus = "attempted" | "succeeded" | "failed" | "skipped";

export type ProviderLedgerPrismaLike = {
  providerCallLedger: {
    aggregate(args: {
      _sum: { estimatedCostCents: true };
      where: { createdAt: { gte: Date } };
    }): Promise<{ _sum: { estimatedCostCents: number | null } }>;
    count(args: {
      where: {
        userId: string;
        createdAt: { gte: Date };
        status: { in: readonly string[] };
      };
    }): Promise<number>;
    findFirst(args: {
      where: { draftId: string; status: { in: readonly string[] } };
      orderBy: { createdAt: "desc" };
      select: { createdAt: true };
    }): Promise<{ createdAt: Date } | null>;
    create(args: { data: ProviderCallLedgerInput }): Promise<{ id: string }>;
  };
};

export type ProviderCallLedgerInput = {
  userId: string;
  draftId: string | null;
  inventoryItemId: string | null;
  provider: string;
  status: ProviderCallStatus;
  skippedReason: PaidProviderSkipReason | null;
  estimatedCostCents: number;
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  queryHash: string | null;
};

export function hashQueries(queries: string[]): string {
  return createHash("sha256")
    .update(queries.join("").toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export async function loadPaidGateUsage(
  prisma: ProviderLedgerPrismaLike,
  args: { userId: string; draftId: string | null; now: Date },
): Promise<PaidGateUsage> {
  const dayStart = utcDayStart(args.now);
  const monthStart = utcMonthStart(args.now);

  const [globalSpend, userCallsToday, userCallsThisMonth, lastDraftCall] =
    await Promise.all([
      prisma.providerCallLedger.aggregate({
        _sum: { estimatedCostCents: true },
        where: { createdAt: { gte: dayStart } },
      }),
      prisma.providerCallLedger.count({
        where: { userId: args.userId, createdAt: { gte: dayStart }, status: { in: COSTING_STATUSES } },
      }),
      prisma.providerCallLedger.count({
        where: { userId: args.userId, createdAt: { gte: monthStart }, status: { in: COSTING_STATUSES } },
      }),
      args.draftId
        ? prisma.providerCallLedger.findFirst({
            where: { draftId: args.draftId, status: { in: COSTING_STATUSES } },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);

  return {
    globalSpentTodayCents: globalSpend._sum.estimatedCostCents ?? 0,
    userCallsToday,
    userCallsThisMonth,
    lastDraftCallAt: lastDraftCall?.createdAt ?? null,
  };
}

export async function recordProviderCall(
  prisma: ProviderLedgerPrismaLike,
  data: ProviderCallLedgerInput,
): Promise<void> {
  await prisma.providerCallLedger.create({ data });
}
