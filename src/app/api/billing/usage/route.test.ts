import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  subscriptionFind: vi.fn(),
  usageFindMany: vi.fn(),
  prisma: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma = {
    subscription: { findUnique: mocks.subscriptionFind },
    usageCounter: { findMany: mocks.usageFindMany },
  };
  mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "s@e.com" });
  mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "pro" });
  mocks.subscriptionFind.mockResolvedValue({
    status: "active",
    currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
  });
  mocks.usageFindMany.mockResolvedValue([
    { metric: "ai_listing", count: 7 },
    { metric: "comp_refresh", count: 3 },
  ]);
});

describe("GET /api/billing/usage", () => {
  it("returns the plan, limits, and current usage", async () => {
    const res = await GET(new Request("http://localhost/api/billing/usage"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plan).toBe("pro");
    expect(body.limits.aiListingsPerMonth).toBe(125);
    expect(body.usage).toEqual({ ai_listing: 7, autopublish: 0, comp_refresh: 3 });
    expect(body.status).toBe("active");
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(mocks.getActiveAccount).toHaveBeenCalledWith("user-1", mocks.prisma);
    expect(mocks.subscriptionFind).toHaveBeenCalledTimes(1);
    expect(mocks.usageFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.usageFindMany).toHaveBeenCalledWith({
      where: {
        accountId: "acc-1",
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
        metric: { in: ["ai_listing", "autopublish", "comp_refresh"] },
      },
      select: { metric: true, count: true },
    });
  });

  it("falls back to free defaults when no subscription row exists", async () => {
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.subscriptionFind.mockResolvedValue(null);

    const body = await (await GET(new Request("http://localhost/api/billing/usage"))).json();
    expect(body.plan).toBe("free");
    expect(body.limits.aiListingsPerMonth).toBe(10);
    expect(body.status).toBe("active");
  });

  it("shows effective kingpin limits for admin users on a free account", async () => {
    vi.stubEnv("ADMIN_EMAILS", "s@e.com");
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.subscriptionFind.mockResolvedValue(null);

    const body = await (await GET(new Request("http://localhost/api/billing/usage"))).json();

    expect(body.plan).toBe("kingpin");
    expect(body.limits.compRefreshesPerMonth).toBe(750);
    expect(body.limits.bulkBatchSize).toBe(250);
    expect(body.status).toBe("active");
  });
});
