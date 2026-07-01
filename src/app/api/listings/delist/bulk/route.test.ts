import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(() => ({})),
  requireSupabaseUser: vi.fn(),
  executeBulkEbayDelist: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/marketplace/bulk-delist", async (orig) => {
  const actual = await orig<typeof import("@/lib/marketplace/bulk-delist")>();
  return { ...actual, executeBulkEbayDelist: mocks.executeBulkEbayDelist };
});

import { POST } from "./route";

const ITEM = "11111111-1111-4111-8111-111111111111";
function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

function req(body: unknown) {
  return new Request("http://localhost/api/listings/delist/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("bulk delist execute route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EBAY_DELIST_EMAILS", "owner@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "u1", plan: "free" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires explicit live confirmation", async () => {
    const response = await POST(req({ itemIds: [ITEM] }));
    expect(response.status).toBe(400);
    expect(mocks.executeBulkEbayDelist).not.toHaveBeenCalled();
  });

  it("rejects a seller without the eBay-delist entitlement before any work", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "nope@example.com" });
    const response = await POST(req({ itemIds: [ITEM], confirmLiveDelist: true }));
    expect(response.status).toBe(403);
    expect(mocks.executeBulkEbayDelist).not.toHaveBeenCalled();
  });

  it("runs the bulk end for an allowlisted, confirmed request", async () => {
    mocks.executeBulkEbayDelist.mockResolvedValue({
      bulkRunId: "run-1",
      total: 1,
      endedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      items: [{ itemId: ITEM, status: "ended", message: "Ended on eBay." }],
    });
    const response = await POST(req({ itemIds: [ITEM], confirmLiveDelist: true }));
    expect(response.status).toBe(200);
    expect(mocks.executeBulkEbayDelist).toHaveBeenCalledOnce();
  });

  it("blocks batches above the account plan cap before delisting", async () => {
    const itemIds = Array.from({ length: 6 }, (_, i) => u(i + 1));
    const response = await POST(req({ itemIds, confirmLiveDelist: true }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BULK_BATCH_TOO_LARGE");
    expect(mocks.executeBulkEbayDelist).not.toHaveBeenCalled();
  });

  it("forwards acting user and active account separately to the delist service", async () => {
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-team",
      ownerUserId: "owner-1",
      plan: "pro",
    });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "admin-1", email: "owner@example.com" });
    mocks.executeBulkEbayDelist.mockResolvedValue({
      bulkRunId: "run-1",
      total: 2,
      endedCount: 1,
      skippedCount: 1,
      failedCount: 0,
      items: [],
    });

    const response = await POST(
      req({ itemIds: [u(1), u(2)], confirmLiveDelist: true, bulkRunId: u(999) }),
    );

    expect(response.status).toBe(200);
    expect(mocks.executeBulkEbayDelist).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "admin-1",
        accountId: "acc-team",
        itemIds: [u(1), u(2)],
        bulkRunId: u(999),
      }),
    );
  });
});
