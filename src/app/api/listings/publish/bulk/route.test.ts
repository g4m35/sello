import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  executeBulkEbayPublish: vi.fn(),
  executeBulkStockXPublish: vi.fn(),
  getActiveAccount: vi.fn(),
  requireRuntimeFeatureAccess: vi.fn(),
  resolveRuntimeEntitlements: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/marketplace/bulk-publish", () => ({
  executeBulkEbayPublish: mocks.executeBulkEbayPublish,
  executeBulkStockXPublish: mocks.executeBulkStockXPublish,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/auth/feature-access", () => ({
  requireRuntimeFeatureAccess: mocks.requireRuntimeFeatureAccess,
  resolveRuntimeEntitlements: mocks.resolveRuntimeEntitlements,
}));

import { POST } from "./route";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}
function req(body: unknown): Request {
  return new Request("http://localhost/api/listings/publish/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("bulk publish execution route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "allowed@example.com");
    mocks.getPrisma.mockReturnValue({});
    const account = { id: "acc-1", ownerUserId: "user-1", plan: "free" };
    mocks.getActiveAccount.mockResolvedValue(account);
    mocks.requireRuntimeFeatureAccess.mockImplementation(async (user: { email?: string | null }) => {
      if (user.email !== "allowed@example.com") {
        throw new AppError(
          "Live eBay publishing is currently enabled for selected alpha accounts.",
          403,
          "LIVE_EBAY_PUBLISH_ALPHA_ONLY",
        );
      }
      const account = await mocks.getActiveAccount();
      return { account, plan: account.plan };
    });
    mocks.resolveRuntimeEntitlements.mockImplementation(async () => {
      const account = await mocks.getActiveAccount();
      return { account, plan: account.plan };
    });
    mocks.executeBulkEbayPublish.mockResolvedValue({
      bulkRunId: u(999),
      total: 1,
      publishedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      needsDetailsCount: 0,
      items: [],
    });
    mocks.executeBulkStockXPublish.mockResolvedValue({
      bulkRunId: u(999),
      total: 1,
      publishedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      needsDetailsCount: 0,
      items: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a batch larger than the plan's bulk limit before publishing", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    // free plan caps bulk batches at 10; send 11.
    const res = await POST(
      req({ itemIds: Array.from({ length: 11 }, (_, i) => u(i + 1)), confirmLivePublish: true }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BULK_BATCH_TOO_LARGE");
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("allows a Pro batch at the plan cap and forwards the active account", async () => {
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-pro", ownerUserId: "owner-1", plan: "pro" });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "member-1", email: "allowed@example.com" });
    const itemIds = Array.from({ length: 25 }, (_, i) => u(i + 1));
    const res = await POST(req({ itemIds, confirmLivePublish: true, bulkRunId: u(999) }));

    expect(res.status).toBe(200);
    expect(mocks.executeBulkEbayPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "member-1",
        accountId: "acc-pro",
        itemIds,
      }),
    );
  });

  it("blocks a Pro batch above the plan cap before publishing", async () => {
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-pro", ownerUserId: "owner-1", plan: "pro" });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "member-1", email: "allowed@example.com" });
    const itemIds = Array.from({ length: 51 }, (_, i) => u(i + 1));
    const res = await POST(req({ itemIds, confirmLivePublish: true }));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BULK_BATCH_TOO_LARGE");
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("allows a Kingpin batch above Pro cap", async () => {
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-kingpin", ownerUserId: "owner-1", plan: "kingpin" });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "admin-1", email: "allowed@example.com" });
    const itemIds = Array.from({ length: 30 }, (_, i) => u(i + 1));
    const res = await POST(req({ itemIds, confirmLivePublish: true }));

    expect(res.status).toBe(200);
    expect(mocks.executeBulkEbayPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "admin-1",
        accountId: "acc-kingpin",
        itemIds,
      }),
    );
  });

  it("rejects anonymous callers before any side effects", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const res = await POST(req({ itemIds: [u(1)], confirmLivePublish: true }));
    expect(res.status).toBe(401);
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("blocks non-allowlisted sellers with 403 before any side effects", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });
    const res = await POST(req({ itemIds: [u(1)], confirmLivePublish: true }));
    const payload = await res.json();
    expect(res.status).toBe(403);
    expect(payload.error.code).toBe("LIVE_EBAY_PUBLISH_ALPHA_ONLY");
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmLivePublish:true", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(req({ itemIds: [u(1)] }));
    expect(res.status).toBe(400);
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("executes for allowlisted sellers and forwards the provided bulkRunId", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(
      req({ itemIds: [u(1), u(2)], confirmLivePublish: true, bulkRunId: u(999) }),
    );
    expect(res.status).toBe(200);
    expect(mocks.executeBulkEbayPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user-1", itemIds: [u(1), u(2)], bulkRunId: u(999) }),
    );
  });

  it("generates a single bulkRunId when none is provided", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    await POST(req({ itemIds: [u(1)], confirmLivePublish: true }));
    const call = mocks.executeBulkEbayPublish.mock.calls[0][1];
    expect(call.bulkRunId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects selections over the transport ceiling before any side effects", async () => {
    vi.stubEnv("BULK_PUBLISH_MAX_ITEMS", "2");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(
      req({ itemIds: [u(1), u(2), u(3)], confirmLivePublish: true }),
    );
    expect(res.status).toBe(400);
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("executes StockX bulk publish for authenticated sellers without the eBay alpha gate", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });
    const res = await POST(
      req({
        itemIds: [u(1), u(2)],
        marketplace: "stockx",
        confirmLivePublish: true,
        bulkRunId: u(999),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.executeBulkStockXPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "user-1",
        accountId: "acc-1",
        itemIds: [u(1), u(2)],
        bulkRunId: u(999),
      }),
    );
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("blocks StockX execution over plan cap before marketplace work", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });
    const res = await POST(
      req({
        itemIds: Array.from({ length: 11 }, (_, i) => u(i + 1)),
        marketplace: "stockx",
        confirmLivePublish: true,
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.executeBulkStockXPublish).not.toHaveBeenCalled();
  });

  it("uses the commercially effective plan for StockX execution", async () => {
    const account = { id: "acc-pro", ownerUserId: "user-1", plan: "pro" };
    mocks.getActiveAccount.mockResolvedValue(account);
    mocks.resolveRuntimeEntitlements.mockResolvedValue({ account, plan: "free" });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });

    const res = await POST(req({
      itemIds: Array.from({ length: 11 }, (_, i) => u(i + 1)),
      marketplace: "stockx",
      confirmLivePublish: true,
    }));

    expect(res.status).toBe(400);
    expect(mocks.executeBulkStockXPublish).not.toHaveBeenCalled();
  });
});
