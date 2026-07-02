import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(() => ({})),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  preflightBulkEbayDelist: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/marketplace/bulk-delist", () => ({
  preflightBulkEbayDelist: mocks.preflightBulkEbayDelist,
}));

import { POST } from "./route";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/listings/delist/bulk/preflight", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("bulk delist preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "owner@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.preflightBulkEbayDelist.mockResolvedValue({
      liveDelistAllowed: false,
      total: 1,
      eligibleCount: 1,
      notListedCount: 0,
      alreadyEndedCount: 0,
      inFlightCount: 0,
      rejectedCount: 0,
      items: [],
    });
  });

  it("rejects selections over the account plan cap before preflight work", async () => {
    const response = await POST(
      req({ itemIds: [u(1), u(2), u(3), u(4), u(5), u(6)] }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BULK_BATCH_TOO_LARGE");
    expect(mocks.preflightBulkEbayDelist).not.toHaveBeenCalled();
  });
});
