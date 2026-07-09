import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

import {
  assertWithinQuota,
  billingPeriodStart,
  getUsage,
  incrementUsage,
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
