import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  accountMemberIds: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/billing/membership", () => ({ accountMemberIds: mocks.accountMemberIds }));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

describe("provider-usage log route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.accountMemberIds.mockResolvedValue(["user-1", "member-1"]);
  });

  it("requires authentication", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const response = await GET(new Request("http://localhost/api/listings/comps/provider-usage"));
    expect(response.status).toBe(401);
  });

  it("scopes every ledger query to active account members", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const findMany = vi.fn().mockResolvedValue([
      { id: "l1", provider: "apify-ebay-sold", status: "succeeded", estimatedCostCents: 35 },
    ]);
    const aggregate = vi.fn().mockResolvedValue({ _sum: { estimatedCostCents: 35 } });
    const count = vi.fn().mockResolvedValue(1);
    mocks.getPrisma.mockReturnValue({
      providerCallLedger: { findMany, aggregate, count },
    });

    const response = await GET(new Request("http://localhost/api/listings/comps/provider-usage"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
    expect(payload.totals.todaySpendCents).toBe(35);

    // The account-member ids come from the active account, never the request.
    expect(findMany.mock.calls[0][0].where).toEqual({
      userId: { in: ["user-1", "member-1"] },
    });
    for (const call of aggregate.mock.calls) {
      expect(call[0].where.userId).toEqual({ in: ["user-1", "member-1"] });
    }
    for (const call of count.mock.calls) {
      expect(call[0].where.userId).toEqual({ in: ["user-1", "member-1"] });
    }
  });

  it("excludes revoked members when membership lookup omits them", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "member-1" });
    mocks.accountMemberIds.mockResolvedValue(["user-1"]);
    const findMany = vi.fn().mockResolvedValue([]);
    const aggregate = vi.fn().mockResolvedValue({ _sum: { estimatedCostCents: null } });
    const count = vi.fn().mockResolvedValue(0);
    mocks.getPrisma.mockReturnValue({
      providerCallLedger: { findMany, aggregate, count },
    });

    const response = await GET(new Request("http://localhost/api/listings/comps/provider-usage"));

    expect(response.status).toBe(200);
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: { in: ["user-1"] } });
  });
});
