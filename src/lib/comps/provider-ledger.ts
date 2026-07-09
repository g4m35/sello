import { createHash } from "node:crypto";

import {
  evaluatePaidProviderGate,
  utcDayStart,
  utcMonthStart,
  type PaidGateConfig,
  type PaidGateUsage,
  type PaidProviderSkipReason,
} from "@/lib/comps/provider-budget";

const COSTING_STATUSES = ["attempted", "succeeded", "failed"] as const;

export type ProviderCallStatus = "attempted" | "succeeded" | "failed" | "skipped";

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

type ProviderCallLedgerUpdate = Pick<
  ProviderCallLedgerInput,
  | "status"
  | "skippedReason"
  | "estimatedCostCents"
  | "fetchedCount"
  | "acceptedCount"
  | "rejectedCount"
>;

export type ProviderLedgerTransaction = {
  // Advisory locks run through $executeRawUnsafe, NOT $queryRawUnsafe:
  // pg_advisory_xact_lock() returns SQL type `void`, which Prisma's $queryRaw*
  // cannot deserialize ("Failed to deserialize column of type 'void'"). $executeRaw*
  // returns an affected-row count and never deserializes the result columns.
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  providerCallLedger: {
    aggregate(args: {
      _sum: { estimatedCostCents: true };
      where: { createdAt: { gte: Date }; status: { in: readonly string[] } };
    }): Promise<{ _sum: { estimatedCostCents: number | null } }>;
    count(args: {
      where: {
        userId: string;
        createdAt: { gte: Date };
        status: { in: readonly string[] };
      };
    }): Promise<number>;
    findFirst(args: {
      where: {
        userId: string;
        draftId: string;
        provider: string;
        status: { in: readonly string[] };
      };
      orderBy: { createdAt: "desc" };
      select: { createdAt: true };
    }): Promise<{ createdAt: Date } | null>;
    create(args: { data: ProviderCallLedgerInput }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: ProviderCallLedgerUpdate;
    }): Promise<{ id: string }>;
  };
};

export type ProviderLedgerPrismaLike = ProviderLedgerTransaction & {
  $transaction<T>(callback: (tx: ProviderLedgerTransaction) => Promise<T>): Promise<T>;
};

export type PaidProviderReservation =
  | { allowed: true; reservationId: string }
  | { allowed: false; reason: PaidProviderSkipReason };

export function hashQueries(queries: string[]): string {
  return createHash("sha256")
    .update(queries.join("\u0001").toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export async function loadPaidGateUsage(
  prisma: ProviderLedgerTransaction,
  args: { userId: string; draftId: string | null; provider: string; now: Date },
): Promise<PaidGateUsage> {
  const dayStart = utcDayStart(args.now);
  const monthStart = utcMonthStart(args.now);

  const [globalSpend, userCallsToday, userCallsThisMonth, lastDraftCall] =
    await Promise.all([
      prisma.providerCallLedger.aggregate({
        _sum: { estimatedCostCents: true },
        where: { createdAt: { gte: dayStart }, status: { in: COSTING_STATUSES } },
      }),
      prisma.providerCallLedger.count({
        where: {
          userId: args.userId,
          createdAt: { gte: dayStart },
          status: { in: COSTING_STATUSES },
        },
      }),
      prisma.providerCallLedger.count({
        where: {
          userId: args.userId,
          createdAt: { gte: monthStart },
          status: { in: COSTING_STATUSES },
        },
      }),
      args.draftId
        ? prisma.providerCallLedger.findFirst({
            where: {
              userId: args.userId,
              draftId: args.draftId,
              provider: args.provider,
              status: { in: COSTING_STATUSES },
            },
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

function reservationLockKeys(args: {
  userId: string;
  draftId: string | null;
  provider: string;
  now: Date;
}): string[] {
  const day = utcDayStart(args.now).toISOString().slice(0, 10);
  const month = utcMonthStart(args.now).toISOString().slice(0, 7);
  return [
    `paid-comps:global:${day}`,
    `paid-comps:user-day:${args.userId}:${day}`,
    `paid-comps:user-month:${args.userId}:${month}`,
    ...(args.draftId ? [`paid-comps:draft:${args.userId}:${args.provider}:${args.draftId}`] : []),
  ].sort();
}

async function acquireReservationLocks(
  tx: ProviderLedgerTransaction,
  args: { userId: string; draftId: string | null; provider: string; now: Date },
): Promise<void> {
  for (const lockKey of reservationLockKeys(args)) {
    // $executeRawUnsafe (not $queryRawUnsafe): pg_advisory_xact_lock returns void
    // and $queryRaw* throws a raw "deserialize column of type 'void'" error.
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      lockKey,
    );
  }
}

export async function reservePaidProviderCall(
  prisma: ProviderLedgerPrismaLike,
  args: {
    config: PaidGateConfig;
    userId: string;
    draftId: string | null;
    inventoryItemId: string | null;
    provider: string;
    queryHash: string | null;
    now: Date;
  },
): Promise<PaidProviderReservation> {
  return prisma.$transaction(async (tx) => {
    await acquireReservationLocks(tx, args);
    const usage = await loadPaidGateUsage(tx, args);
    const gate = evaluatePaidProviderGate({ config: args.config, usage, now: args.now });

    if (!gate.allowed) {
      await tx.providerCallLedger.create({
        data: {
          userId: args.userId,
          draftId: args.draftId,
          inventoryItemId: args.inventoryItemId,
          provider: args.provider,
          status: "skipped",
          skippedReason: gate.reason,
          estimatedCostCents: 0,
          fetchedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          queryHash: args.queryHash,
        },
      });
      return { allowed: false, reason: gate.reason };
    }

    const reservation = await tx.providerCallLedger.create({
      data: {
        userId: args.userId,
        draftId: args.draftId,
        inventoryItemId: args.inventoryItemId,
        provider: args.provider,
        status: "attempted",
        skippedReason: null,
        estimatedCostCents: args.config.estimatedCostCents,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        queryHash: args.queryHash,
      },
    });
    return { allowed: true, reservationId: reservation.id };
  });
}

export async function completeProviderCall(
  prisma: ProviderLedgerPrismaLike,
  args: {
    reservationId: string;
    status: "succeeded" | "failed" | "skipped";
    skippedReason?: PaidProviderSkipReason | null;
    estimatedCostCents: number;
    fetchedCount: number;
    acceptedCount: number;
    rejectedCount: number;
  },
): Promise<void> {
  const skippedReason =
    args.skippedReason !== undefined
      ? args.skippedReason
      : args.status === "failed"
        ? "provider_error"
        : null;

  await prisma.providerCallLedger.update({
    where: { id: args.reservationId },
    data: {
      status: args.status,
      skippedReason,
      estimatedCostCents: args.estimatedCostCents,
      fetchedCount: args.fetchedCount,
      acceptedCount: args.acceptedCount,
      rejectedCount: args.rejectedCount,
    },
  });
}

export async function recordProviderCall(
  prisma: ProviderLedgerTransaction,
  data: ProviderCallLedgerInput,
): Promise<void> {
  await prisma.providerCallLedger.create({ data });
}
