import "server-only";

import { isAdminUser } from "@/lib/auth/admin";
import type { UsageReservationStatus } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

import { quotaExceeded, type UsageMetricKey } from "./errors";
import { effectiveLimitsForUser } from "./effective-plan";
import { limitsFor, type PlanId, type PlanLimits } from "./plans";

type Db = ReturnType<typeof getPrisma>;

const METRIC_LIMIT_FIELD: Record<UsageMetricKey, keyof PlanLimits> = {
  ai_listing: "aiListingsPerMonth",
  autopublish: "autopublishesPerMonth",
  comp_refresh: "compRefreshesPerMonth",
};

type QuotaUser = { id?: string | null; email?: string | null };

export type UsageReservationDenialReason =
  | "USAGE_LIMIT_EXCEEDED"
  | "USAGE_RESERVATION_RELEASED"
  | "USAGE_RESERVATION_EXPIRED"
  | "USAGE_RESERVATION_DENIED";

export type UsageReservationResult =
  | {
      allowed: true;
      reservationId: string;
      idempotent: boolean;
      status: "reserved" | "settled";
      used: number;
      limit: number;
      periodStart: Date;
    }
  | {
      allowed: false;
      reservationId: string;
      idempotent: boolean;
      reason: UsageReservationDenialReason;
      used: number;
      limit: number;
      periodStart: Date;
    };

type ReservationRow = {
  id: string;
  status: UsageReservationStatus;
  units: number;
  limitSnapshot: number;
  periodStart: Date;
  denialReason: string | null;
};

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

function reservationLockKey(accountId: string, metric: UsageMetricKey, periodStart: Date) {
  return `usage:${accountId}:${metric}:${periodStart.toISOString().slice(0, 10)}`;
}

function denialForStatus(row: ReservationRow): UsageReservationDenialReason {
  if (row.status === "released") return "USAGE_RESERVATION_RELEASED";
  if (row.status === "expired") return "USAGE_RESERVATION_EXPIRED";
  return row.denialReason === "USAGE_LIMIT_EXCEEDED"
    ? "USAGE_LIMIT_EXCEEDED"
    : "USAGE_RESERVATION_DENIED";
}

function resultForExisting(row: ReservationRow, used: number): UsageReservationResult {
  if (row.status === "reserved" || row.status === "settled") {
    return {
      allowed: true,
      reservationId: row.id,
      idempotent: true,
      status: row.status,
      used,
      limit: row.limitSnapshot,
      periodStart: row.periodStart,
    };
  }
  return {
    allowed: false,
    reservationId: row.id,
    idempotent: true,
    reason: denialForStatus(row),
    used,
    limit: row.limitSnapshot,
    periodStart: row.periodStart,
  };
}

/**
 * Atomically checks the account's current plan limit and reserves usage.
 * The advisory lock serializes all members and requests for the same
 * account/metric/period, while the database unique key makes request retries
 * idempotent. UsageCounter includes both settled and in-flight reservations;
 * release/expiry subtracts units, settlement does not increment again.
 */
export async function reserveUsage(
  args: {
    accountId: string;
    metric: UsageMetricKey;
    idempotencyKey: string;
    now: Date;
    units?: number;
    user?: QuotaUser;
  },
  prisma: Db = getPrisma(),
): Promise<UsageReservationResult> {
  const units = args.units ?? 1;
  if (!Number.isInteger(units) || units <= 0) {
    throw new AppError("Usage reservation units must be a positive integer.", 400, "USAGE_UNITS_INVALID");
  }
  const idempotencyKey = args.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new AppError(
      "A valid usage idempotency key is required.",
      400,
      "USAGE_IDEMPOTENCY_KEY_INVALID",
    );
  }

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { accountId: args.accountId },
      select: { currentPeriodStart: true },
    });
    const periodStart = billingPeriodStart(args.now, subscription);
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      reservationLockKey(args.accountId, args.metric, periodStart),
    );

    const existing = await tx.usageReservation.findUnique({
      where: {
        accountId_metric_idempotencyKey: {
          accountId: args.accountId,
          metric: args.metric,
          idempotencyKey,
        },
      },
      select: {
        id: true,
        status: true,
        units: true,
        limitSnapshot: true,
        periodStart: true,
        denialReason: true,
      },
    });
    if (existing) {
      const counter = await tx.usageCounter.findUnique({
        where: {
          accountId_metric_periodStart: {
            accountId: args.accountId,
            metric: args.metric,
            periodStart: existing.periodStart,
          },
        },
        select: { count: true },
      });
      return resultForExisting(existing, counter?.count ?? 0);
    }

    const account = await tx.account.findUnique({
      where: { id: args.accountId },
      select: { plan: true },
    });
    if (!account) {
      throw new AppError("Account not found.", 404, "ACCOUNT_NOT_FOUND");
    }
    const limit = effectiveLimitsForUser(account, args.user ?? {})[
      METRIC_LIMIT_FIELD[args.metric]
    ];
    const counter = await tx.usageCounter.upsert({
      where: {
        accountId_metric_periodStart: {
          accountId: args.accountId,
          metric: args.metric,
          periodStart,
        },
      },
      create: { accountId: args.accountId, metric: args.metric, periodStart, count: 0 },
      update: {},
      select: { count: true },
    });

    if (counter.count + units > limit) {
      const denied = await tx.usageReservation.create({
        data: {
          accountId: args.accountId,
          metric: args.metric,
          periodStart,
          idempotencyKey,
          units,
          status: "denied",
          planSnapshot: account.plan,
          limitSnapshot: limit,
          denialReason: "USAGE_LIMIT_EXCEEDED",
          reservedByUserId: args.user?.id ?? null,
        },
        select: { id: true },
      });
      return {
        allowed: false,
        reservationId: denied.id,
        idempotent: false,
        reason: "USAGE_LIMIT_EXCEEDED",
        used: counter.count,
        limit,
        periodStart,
      };
    }

    const reservation = await tx.usageReservation.create({
      data: {
        accountId: args.accountId,
        metric: args.metric,
        periodStart,
        idempotencyKey,
        units,
        status: "reserved",
        planSnapshot: account.plan,
        limitSnapshot: limit,
        denialReason: null,
        reservedByUserId: args.user?.id ?? null,
      },
      select: { id: true },
    });
    const updated = await tx.usageCounter.update({
      where: {
        accountId_metric_periodStart: {
          accountId: args.accountId,
          metric: args.metric,
          periodStart,
        },
      },
      data: { count: { increment: units } },
      select: { count: true },
    });
    return {
      allowed: true,
      reservationId: reservation.id,
      idempotent: false,
      status: "reserved",
      used: updated.count,
      limit,
      periodStart,
    };
  });
}

export async function reserveUsageOrThrow(
  args: Parameters<typeof reserveUsage>[0],
  prisma: Db = getPrisma(),
): Promise<Extract<UsageReservationResult, { allowed: true }>> {
  const result = await reserveUsage(args, prisma);
  if (!result.allowed) {
    if (result.reason === "USAGE_LIMIT_EXCEEDED") throw quotaExceeded(args.metric);
    throw new AppError(
      "This request has already reached a terminal usage state.",
      409,
      result.reason,
    );
  }
  return result;
}

export async function settleUsageReservation(
  reservationId: string,
  now: Date,
  prisma: Db = getPrisma(),
): Promise<boolean> {
  const settled = await prisma.usageReservation.updateMany({
    where: { id: reservationId, status: "reserved" },
    data: { status: "settled", settledAt: now },
  });
  if (settled.count === 1) return true;
  const existing = await prisma.usageReservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  });
  return existing?.status === "settled";
}

export async function releaseUsageReservation(
  reservationId: string,
  now: Date,
  prisma: Db = getPrisma(),
  status: "released" | "expired" = "released",
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.usageReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        accountId: true,
        metric: true,
        periodStart: true,
        units: true,
        status: true,
      },
    });
    if (!reservation) return false;
    if (reservation.status === status) return true;
    if (reservation.status !== "reserved") return false;
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      reservationLockKey(reservation.accountId, reservation.metric, reservation.periodStart),
    );
    const released = await tx.usageReservation.updateMany({
      where: { id: reservation.id, status: "reserved" },
      data: { status, releasedAt: now },
    });
    if (released.count !== 1) return false;
    await tx.usageCounter.update({
      where: {
        accountId_metric_periodStart: {
          accountId: reservation.accountId,
          metric: reservation.metric,
          periodStart: reservation.periodStart,
        },
      },
      data: { count: { decrement: reservation.units } },
    });
    return true;
  });
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
