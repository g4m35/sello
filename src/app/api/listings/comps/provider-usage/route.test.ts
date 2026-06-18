import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

describe("provider-usage log route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const response = await GET(new Request("http://localhost/api/listings/comps/provider-usage"));
    expect(response.status).toBe(401);
  });

  it("scopes every ledger query to the authenticated user (no cross-user access)", async () => {
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

    // The user id used in every query comes from the verified session, never the
    // request, and is always "user-1".
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: "user-1" });
    for (const call of aggregate.mock.calls) {
      expect(call[0].where.userId).toBe("user-1");
    }
    for (const call of count.mock.calls) {
      expect(call[0].where.userId).toBe("user-1");
    }
  });
});
