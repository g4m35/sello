import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  getUsage: vi.fn(),
  subscriptionFind: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/billing/usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/usage")>();
  return { ...actual, getUsage: mocks.getUsage };
});
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ subscription: { findUnique: mocks.subscriptionFind } }),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "s@e.com" });
  mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "pro" });
  mocks.getUsage.mockImplementation(async (_id: string, metric: string) =>
    metric === "ai_listing" ? 7 : metric === "comp_refresh" ? 3 : 0,
  );
  mocks.subscriptionFind.mockResolvedValue({
    status: "active",
    currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
  });
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
  });

  it("falls back to free defaults when no subscription row exists", async () => {
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.subscriptionFind.mockResolvedValue(null);

    const body = await (await GET(new Request("http://localhost/api/billing/usage"))).json();
    expect(body.plan).toBe("free");
    expect(body.limits.aiListingsPerMonth).toBe(10);
    expect(body.status).toBe("active");
  });
});
