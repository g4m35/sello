import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

import {
  assertWithinQuota,
  billingPeriodStart,
  getUsage,
  incrementUsage,
  markUsageWorkStarted,
  reconcileStaleUsageReservations,
  releaseUsageReservation,
  reserveUsage,
  settleUsageReservation,
  settleUsageReservationOrRequireReconciliation,
} from "./usage";

describe("billingPeriodStart", () => {
  it("falls back to the first of the calendar month (UTC) without a subscription", () => {
    const start = billingPeriodStart(new Date("2026-06-25T12:00:00Z"), null);
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("uses the subscription period start, floored to its UTC date", () => {
    const start = billingPeriodStart(new Date("2026-06-25T12:00:00Z"), {
      currentPeriodStart: new Date("2026-06-10T08:30:00Z"),
    });
    expect(start.toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });
});

function prismaWith(opts: {
  count?: number;
  upsert?: ReturnType<typeof vi.fn>;
  periodStart?: Date | null;
}) {
  const subscriptionFind = vi.fn().mockResolvedValue(
    opts.periodStart === undefined ? null : { currentPeriodStart: opts.periodStart },
  );
  const counterFind = vi
    .fn()
    .mockResolvedValue(opts.count === undefined ? null : { count: opts.count });
  const upsert = opts.upsert ?? vi.fn().mockResolvedValue({});
  const prisma = {
    subscription: { findUnique: subscriptionFind },
    usageCounter: { findUnique: counterFind, upsert },
  } as never;
  return { prisma, counterFind, upsert };
}

const now = new Date("2026-06-25T12:00:00Z");

describe("getUsage", () => {
  it("returns 0 when no counter row exists", async () => {
    const { prisma } = prismaWith({});
    expect(await getUsage("acc-1", "ai_listing", now, prisma)).toBe(0);
  });

  it("returns the stored count", async () => {
    const { prisma } = prismaWith({ count: 7 });
    expect(await getUsage("acc-1", "ai_listing", now, prisma)).toBe(7);
  });
});

describe("assertWithinQuota", () => {
  it("passes below the plan limit", async () => {
    const { prisma } = prismaWith({ count: 9 });
    await expect(
      assertWithinQuota({ id: "acc-1", plan: "free" }, "ai_listing", now, { prisma }),
    ).resolves.toBeUndefined();
  });

  it("throws QUOTA_EXCEEDED at the plan limit", async () => {
    const { prisma } = prismaWith({ count: 10 });
    await expect(
      assertWithinQuota({ id: "acc-1", plan: "free" }, "ai_listing", now, { prisma }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED_AI_LISTING" });
  });

  it("uses the plan's higher limit for pro but still blocks free at 100", async () => {
    const { prisma } = prismaWith({ count: 100 });
    await expect(
      assertWithinQuota({ id: "acc-1", plan: "pro" }, "ai_listing", now, { prisma }),
    ).resolves.toBeUndefined();
    await expect(
      assertWithinQuota({ id: "acc-1", plan: "free" }, "ai_listing", now, { prisma }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("never quotas allow-listed admins even when over the plan limit", async () => {
    const { prisma } = prismaWith({ count: 10_000 });
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    await expect(
      assertWithinQuota(
        { id: "acc-1", plan: "free" },
        "ai_listing",
        now,
        { prisma, user: { email: "owner@example.com" } },
      ),
    ).resolves.toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe("incrementUsage", () => {
  it("upserts the counter with an increment", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const { prisma } = prismaWith({ upsert });

    await incrementUsage("acc-1", "comp_refresh", now, 1, prisma);

    const arg = upsert.mock.calls[0][0];
    expect(arg.where.accountId_metric_periodStart).toMatchObject({
      accountId: "acc-1",
      metric: "comp_refresh",
    });
    expect(arg.create.count).toBe(1);
    expect(arg.update.count).toEqual({ increment: 1 });
  });
});

type Plan = "free" | "pro" | "kingpin";
type Metric = "ai_listing" | "autopublish" | "comp_refresh";
type CounterCompound = { accountId: string; metric: Metric; periodStart: Date };
type ReservationTestRow = {
  id: string;
  accountId: string;
  metric: Metric;
  periodStart: Date;
  idempotencyKey: string;
  units: number;
  status: "reserved" | "settled" | "released" | "expired" | "denied";
  limitSnapshot: number;
  denialReason: string | null;
  operationType: string;
  operationId: string;
  expiresAt: Date | null;
  workStartedAt: Date | null;
  reconciliationRequiredAt: Date | null;
  lastErrorCode: string | null;
};

function reservationPrisma(opts: {
  plan?: Plan;
  count?: number;
  periodStart?: Date | null;
  subscriptionStatus?: "active" | "trialing" | "past_due" | "canceled" | "unpaid";
  graceEndsAt?: Date | null;
} = {}) {
  const account = { id: "acc-1", plan: opts.plan ?? "free" };
  const periodStart = opts.periodStart ?? null;
  const counters = new Map<string, number>();
  const reservations = new Map<string, ReservationTestRow>();
  let nextId = 1;
  let serial = Promise.resolve();
  const counterKey = (accountId: string, metric: string, start: Date) =>
    `${accountId}:${metric}:${start.toISOString().slice(0, 10)}`;
  const initialStart = billingPeriodStart(now, periodStart ? { currentPeriodStart: periodStart } : null);
  counters.set(counterKey(account.id, "ai_listing", initialStart), opts.count ?? 0);

  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    subscription: {
      findUnique: vi.fn().mockImplementation(async () => {
        if (account.plan === "free" && periodStart === null && !opts.subscriptionStatus) {
          return null;
        }
        return {
          currentPeriodStart: periodStart,
          status: opts.subscriptionStatus ?? "active",
          graceEndsAt: opts.graceEndsAt ?? null,
        };
      }),
    },
    account: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
        where.id === account.id ? { plan: account.plan } : null,
      ),
    },
    usageCounter: {
      findUnique: vi.fn().mockImplementation(async ({ where }: {
        where: { accountId_metric_periodStart: CounterCompound };
      }) => {
        const key = counterKey(
          where.accountId_metric_periodStart.accountId,
          where.accountId_metric_periodStart.metric,
          where.accountId_metric_periodStart.periodStart,
        );
        const count = counters.get(key);
        return count === undefined ? null : { count };
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create }: {
        where: { accountId_metric_periodStart: CounterCompound };
        create: { count: number };
      }) => {
        const compound = where.accountId_metric_periodStart;
        const key = counterKey(compound.accountId, compound.metric, compound.periodStart);
        if (!counters.has(key)) counters.set(key, create.count);
        return { count: counters.get(key)! };
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: {
        where: { accountId_metric_periodStart: CounterCompound };
        data: { count: { increment?: number; decrement?: number } };
      }) => {
        const compound = where.accountId_metric_periodStart;
        const key = counterKey(compound.accountId, compound.metric, compound.periodStart);
        const current = counters.get(key) ?? 0;
        const next = data.count.increment !== undefined
          ? current + data.count.increment
          : current - (data.count.decrement ?? 0);
        counters.set(key, next);
        return { count: next };
      }),
    },
    usageReservation: {
      findMany: vi.fn().mockImplementation(async ({ where, take }: {
        where: {
          status: ReservationTestRow["status"];
          expiresAt: { lte: Date };
          accountId?: string;
        };
        take: number;
      }) => [...reservations.values()]
        .filter((row) =>
          row.status === where.status &&
          row.expiresAt !== null &&
          row.expiresAt <= where.expiresAt.lte &&
          (!where.accountId || row.accountId === where.accountId),
        )
        .slice(0, take)
        .map((row) => ({ id: row.id, workStartedAt: row.workStartedAt }))),
      findUnique: vi.fn().mockImplementation(async ({ where }: {
        where:
          | { id: string }
          | { accountId_metric_idempotencyKey: { accountId: string; metric: Metric; idempotencyKey: string } };
      }) => {
        if ("id" in where) return reservations.get(where.id) ?? null;
        const compound = where.accountId_metric_idempotencyKey;
        return [...reservations.values()].find(
          (row) => row.accountId === compound.accountId &&
            row.metric === compound.metric &&
            row.idempotencyKey === compound.idempotencyKey,
        ) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: {
        data: Omit<ReservationTestRow, "id"> & Record<string, unknown>;
      }) => {
        const id = `reservation-${nextId++}`;
        reservations.set(id, {
          id,
          ...data,
          expiresAt: data.expiresAt ?? null,
          workStartedAt: data.workStartedAt ?? null,
          reconciliationRequiredAt: data.reconciliationRequiredAt ?? null,
          lastErrorCode: data.lastErrorCode ?? null,
        });
        return { id };
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: {
        where: { id: string; status?: ReservationTestRow["status"] };
        data: Partial<ReservationTestRow> & Record<string, unknown>;
      }) => {
        const row = reservations.get(where.id);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction<T>(callback: (client: typeof tx) => Promise<T>): Promise<T> {
      const result = serial.then(() => callback(tx));
      serial = result.then(() => undefined, () => undefined);
      return result;
    },
  } as never;

  return { prisma, tx, account, counters, reservations, counterKey };
}

describe("atomic usage reservations", () => {
  it("allows only one of two concurrent requests competing for the final unit", async () => {
    const state = reservationPrisma({ count: 9 });
    const [first, second] = await Promise.all([
      reserveUsage({
        accountId: "acc-1",
        metric: "ai_listing",
        idempotencyKey: "request-final-a",
        operationType: "listing_draft",
        operationId: "draft-final-a",
        now,
        user: { id: "member-1" },
      }, state.prisma),
      reserveUsage({
        accountId: "acc-1",
        metric: "ai_listing",
        idempotencyKey: "request-final-b",
        operationType: "listing_draft",
        operationId: "draft-final-b",
        now,
        user: { id: "member-2" },
      }, state.prisma),
    ]);

    expect([first.allowed, second.allowed].sort()).toEqual([false, true]);
    expect(Math.max(first.used, second.used)).toBe(10);
  });

  it("deduplicates repeated idempotency keys without consuming twice", async () => {
    const state = reservationPrisma();
    const args = {
      accountId: "acc-1",
      metric: "ai_listing" as const,
      idempotencyKey: "same-request-key",
      operationType: "listing_draft" as const,
      operationId: "same-draft",
      now,
      user: { id: "member-1" },
    };
    const [first, second] = await Promise.all([
      reserveUsage(args, state.prisma),
      reserveUsage(args, state.prisma),
    ]);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.reservationId).toBe(first.reservationId);
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
    expect(Math.max(first.used, second.used)).toBe(1);
  });

  it("shares the account limit across members", async () => {
    const state = reservationPrisma({ count: 9 });
    const first = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "member-one-request",
      operationType: "listing_draft",
      operationId: "member-one-draft",
      now,
      user: { id: "member-1" },
    }, state.prisma);
    const second = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "member-two-request",
      operationType: "listing_draft",
      operationId: "member-two-draft",
      now,
      user: { id: "member-2" },
    }, state.prisma);

    expect(first.allowed).toBe(true);
    expect(second).toMatchObject({ allowed: false, reason: "USAGE_LIMIT_EXCEEDED" });
  });

  it("releases capacity when work never starts and settles idempotently", async () => {
    const state = reservationPrisma({ count: 9 });
    const reserved = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "release-after-claim",
      operationType: "listing_draft",
      operationId: "release-draft",
      now,
    }, state.prisma);
    expect(reserved.allowed).toBe(true);
    expect(await releaseUsageReservation(reserved.reservationId, now, state.prisma)).toBe(true);
    expect(await releaseUsageReservation(reserved.reservationId, now, state.prisma)).toBe(true);

    const replacement = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "replacement-claim",
      operationType: "listing_draft",
      operationId: "replacement-draft",
      now,
    }, state.prisma);
    expect(replacement.allowed).toBe(true);
    expect(await settleUsageReservation(replacement.reservationId, now, state.prisma)).toBe(true);
    expect(await settleUsageReservation(replacement.reservationId, now, state.prisma)).toBe(true);
  });

  it("honors a reservation snapshot across a plan downgrade and gates new work", async () => {
    const state = reservationPrisma({ plan: "pro", count: 10 });
    const reserved = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "pro-before-downgrade",
      operationType: "listing_draft",
      operationId: "pro-draft",
      now,
    }, state.prisma);
    expect(reserved.allowed).toBe(true);

    state.account.plan = "free";
    expect(await settleUsageReservation(reserved.reservationId, now, state.prisma)).toBe(true);
    await expect(
      reserveUsage({
        accountId: "acc-1",
        metric: "ai_listing",
        idempotencyKey: "free-after-downgrade",
        operationType: "listing_draft",
        operationId: "free-draft",
        now,
      }, state.prisma),
    ).resolves.toMatchObject({ allowed: false, reason: "USAGE_LIMIT_EXCEEDED" });
  });

  it("uses free quota for paid accounts outside their commercial grace window", async () => {
    const state = reservationPrisma({
      plan: "pro",
      count: 10,
      subscriptionStatus: "past_due",
      graceEndsAt: new Date("2026-06-25T11:59:59Z"),
    });
    await expect(
      reserveUsage({
        accountId: "acc-1",
        metric: "ai_listing",
        idempotencyKey: "expired-grace-request",
        operationType: "listing_draft",
        operationId: "expired-grace-draft",
        now,
      }, state.prisma),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "USAGE_LIMIT_EXCEEDED",
      limit: 10,
    });
  });

  it("allows configured admins without bypassing durable accounting", async () => {
    const state = reservationPrisma({ count: 10_000 });
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    const result = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "admin-reservation",
      operationType: "listing_draft",
      operationId: "admin-draft",
      now,
      user: { id: "admin-1", email: "owner@example.com" },
    }, state.prisma);
    vi.unstubAllEnvs();

    expect(result).toMatchObject({ allowed: true, used: 10_001 });
    expect(state.reservations.size).toBe(1);
  });

  it("uses independent UTC calendar-month counters after rollover", async () => {
    const state = reservationPrisma({ count: 10 });
    const july = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "july-request-key",
      operationType: "listing_draft",
      operationId: "july-draft",
      now,
    }, state.prisma);
    const august = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "august-request-key",
      operationType: "listing_draft",
      operationId: "august-draft",
      now: new Date("2026-08-01T00:00:00Z"),
    }, state.prisma);

    expect(july.allowed).toBe(false);
    expect(august).toMatchObject({ allowed: true, used: 1 });
  });

  it("expires a crashed reservation only when work never started", async () => {
    const state = reservationPrisma({ count: 9 });
    const reserved = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "crash-before-work",
      operationType: "listing_draft",
      operationId: "draft-before-work",
      now,
      expiresAt: new Date("2026-06-25T12:01:00Z"),
    }, state.prisma);
    expect(reserved.allowed).toBe(true);

    const summary = await reconcileStaleUsageReservations({
      now: new Date("2026-06-25T12:02:00Z"),
    }, state.prisma);

    expect(summary).toEqual({ inspected: 1, expiredBeforeWork: 1, requiresReconciliation: 0 });
    expect(state.reservations.get(reserved.reservationId)?.status).toBe("expired");
    expect(Math.max(...state.counters.values())).toBe(9);
  });

  it("retains capacity and flags reconciliation after a crash during work", async () => {
    const state = reservationPrisma({ count: 9 });
    const reserved = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "crash-during-work",
      operationType: "marketplace_publish",
      operationId: "item-1:ebay",
      now,
      expiresAt: new Date("2026-06-25T12:01:00Z"),
    }, state.prisma);
    expect(reserved.allowed).toBe(true);
    await markUsageWorkStarted(reserved.reservationId, now, state.prisma);

    const summary = await reconcileStaleUsageReservations({
      now: new Date("2026-06-25T12:02:00Z"),
    }, state.prisma);

    expect(summary).toEqual({ inspected: 1, expiredBeforeWork: 0, requiresReconciliation: 1 });
    expect(state.reservations.get(reserved.reservationId)).toMatchObject({
      status: "reserved",
      lastErrorCode: "USAGE_WORK_OUTCOME_UNKNOWN",
    });
    expect(Math.max(...state.counters.values())).toBe(10);
    await expect(
      releaseUsageReservation(reserved.reservationId, now, state.prisma),
    ).resolves.toBe(false);
  });

  it("makes a settlement failure durable and recoverable without releasing quota", async () => {
    const state = reservationPrisma();
    const reserved = await reserveUsage({
      accountId: "acc-1",
      metric: "ai_listing",
      idempotencyKey: "crash-at-settle",
      operationType: "listing_draft",
      operationId: "draft-at-settle",
      now,
    }, state.prisma);
    expect(reserved.allowed).toBe(true);
    await markUsageWorkStarted(reserved.reservationId, now, state.prisma);
    const implementation = state.tx.usageReservation.updateMany.getMockImplementation();
    state.tx.usageReservation.updateMany
      .mockRejectedValueOnce(new Error("temporary write failure"))
      .mockImplementation(implementation!);

    await expect(
      settleUsageReservationOrRequireReconciliation(
        reserved.reservationId,
        now,
        "AI_LISTING_SETTLEMENT_FAILED",
        state.prisma,
      ),
    ).resolves.toBe("reconciliation_required");
    expect(state.reservations.get(reserved.reservationId)).toMatchObject({
      status: "reserved",
      operationType: "listing_draft",
      operationId: "draft-at-settle",
      lastErrorCode: "AI_LISTING_SETTLEMENT_FAILED",
    });
    expect(Math.max(...state.counters.values())).toBe(1);
    await expect(
      settleUsageReservation(reserved.reservationId, new Date(now.getTime() + 1), state.prisma),
    ).resolves.toBe(true);
  });

  it("keeps a started reservation charged when settlement and its immediate marker both fail", async () => {
    const state = reservationPrisma();
    const reserved = await reserveUsage({
      accountId: "acc-1",
      metric: "autopublish",
      idempotencyKey: "publish-settlement-outage",
      operationType: "marketplace_publish",
      operationId: "item-1:ebay",
      now,
    }, state.prisma);
    expect(reserved.allowed).toBe(true);
    await markUsageWorkStarted(reserved.reservationId, now, state.prisma);
    const implementation = state.tx.usageReservation.updateMany.getMockImplementation();
    state.tx.usageReservation.updateMany
      .mockRejectedValueOnce(new Error("settlement write unavailable"))
      .mockRejectedValueOnce(new Error("reconciliation marker unavailable"))
      .mockImplementation(implementation!);

    await expect(
      settleUsageReservationOrRequireReconciliation(
        reserved.reservationId,
        now,
        "AUTOPUBLISH_SETTLEMENT_FAILED",
        state.prisma,
      ),
    ).rejects.toThrow("reconciliation marker unavailable");

    expect(state.reservations.get(reserved.reservationId)).toMatchObject({
      status: "reserved",
      workStartedAt: now,
    });
    expect(Math.max(...state.counters.values())).toBe(1);
  });
});
