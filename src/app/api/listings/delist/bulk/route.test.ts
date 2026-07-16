import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(() => ({})),
  requireSupabaseUser: vi.fn(),
  executeBulkEbayDelist: vi.fn(),
  executeBulkStockXDelist: vi.fn(),
  getActiveAccount: vi.fn(),
  requireRuntimeFeatureAccess: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/auth/feature-access", () => ({
  requireRuntimeFeatureAccess: mocks.requireRuntimeFeatureAccess,
}));
vi.mock("@/lib/marketplace/bulk-delist", async (orig) => {
  const actual = await orig<typeof import("@/lib/marketplace/bulk-delist")>();
  return {
    ...actual,
    executeBulkEbayDelist: mocks.executeBulkEbayDelist,
    executeBulkStockXDelist: mocks.executeBulkStockXDelist,
  };
});

import { AppError } from "@/lib/errors";
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
    const account = { id: "acc-1", ownerUserId: "u1", plan: "free" };
    mocks.getActiveAccount.mockResolvedValue(account);
    mocks.requireRuntimeFeatureAccess.mockImplementation(async (user: { email?: string | null }) => {
      if (user.email !== "owner@example.com") {
        throw new AppError(
          "Live eBay delisting is currently enabled for selected alpha accounts.",
          403,
          "EBAY_DELIST_ALPHA_ONLY",
        );
      }
      return { account: await mocks.getActiveAccount() };
    });
    mocks.executeBulkStockXDelist.mockResolvedValue({
      bulkRunId: "run-1",
      total: 1,
      endedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      items: [],
    });
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

  it("runs StockX bulk delist for authenticated sellers without the eBay delist entitlement", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "nope@example.com" });

    const response = await POST(
      req({
        itemIds: [ITEM],
        marketplace: "stockx",
        confirmLiveDelist: true,
        bulkRunId: u(999),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.executeBulkStockXDelist).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "u1",
        accountId: "acc-1",
        itemIds: [ITEM],
        bulkRunId: u(999),
      }),
    );
    expect(mocks.executeBulkEbayDelist).not.toHaveBeenCalled();
  });

  it("blocks StockX bulk delist above the account plan cap before marketplace work", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "nope@example.com" });
    const itemIds = Array.from({ length: 6 }, (_, i) => u(i + 1));

    const response = await POST(
      req({ itemIds, marketplace: "stockx", confirmLiveDelist: true }),
    );

    expect(response.status).toBe(400);
    expect(mocks.executeBulkStockXDelist).not.toHaveBeenCalled();
  });
});
