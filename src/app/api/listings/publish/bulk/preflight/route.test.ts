import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  preflightBulkEbayPublish: vi.fn(),
  preflightBulkStockXPublish: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/marketplace/bulk-publish", () => ({
  preflightBulkEbayPublish: mocks.preflightBulkEbayPublish,
  preflightBulkStockXPublish: mocks.preflightBulkStockXPublish,
}));

import { POST } from "./route";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}
function req(body: unknown): Request {
  return new Request("http://localhost/api/listings/publish/bulk/preflight", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("bulk publish preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "allowed@example.com");
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.getPrisma.mockReturnValue({});
    mocks.preflightBulkEbayPublish.mockResolvedValue({
      livePublishAllowed: false,
      total: 1,
      readyCount: 1,
      needsDetailsCount: 0,
      skippedCount: 0,
      rejectedCount: 0,
      items: [],
    });
    mocks.preflightBulkStockXPublish.mockResolvedValue({
      livePublishAllowed: true,
      total: 1,
      readyCount: 1,
      needsDetailsCount: 0,
      skippedCount: 0,
      rejectedCount: 0,
      items: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects anonymous callers before any work", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const res = await POST(req({ itemIds: [u(1)] }));
    expect(res.status).toBe(401);
    expect(mocks.preflightBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("is available to non-allowlisted sellers with livePublishAllowed:false", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });
    const res = await POST(req({ itemIds: [u(1), u(2)] }));
    expect(res.status).toBe(200);
    expect(mocks.preflightBulkEbayPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user-1", accountId: "acc-1", livePublishAllowed: false }),
    );
  });

  it("passes livePublishAllowed:true for allowlisted sellers", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    await POST(req({ itemIds: [u(1)] }));
    expect(mocks.preflightBulkEbayPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ accountId: "acc-1", livePublishAllowed: true }),
    );
  });

  it("rejects selections over the transport ceiling before any work", async () => {
    vi.stubEnv("BULK_PUBLISH_MAX_ITEMS", "2");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(req({ itemIds: [u(1), u(2), u(3)] }));
    expect(res.status).toBe(400);
    expect(mocks.preflightBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("rejects selections over the account plan cap before preflight work", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(
      req({ itemIds: [u(1), u(2), u(3), u(4), u(5), u(6)] }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BULK_BATCH_TOO_LARGE");
    expect(mocks.preflightBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(req({ itemIds: [] }));
    expect(res.status).toBe(400);
    expect(mocks.preflightBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("routes StockX preflight through active account scope without requiring eBay allowlist", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });

    const res = await POST(req({ itemIds: [u(1), u(2)], marketplace: "stockx" }));

    expect(res.status).toBe(200);
    expect(mocks.preflightBulkStockXPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        userId: "user-1",
        accountId: "acc-1",
        itemIds: [u(1), u(2)],
      }),
    );
    expect(mocks.preflightBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("blocks StockX preflight over plan cap before marketplace work", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });
    const res = await POST(
      req({ itemIds: [u(1), u(2), u(3), u(4), u(5), u(6)], marketplace: "stockx" }),
    );

    expect(res.status).toBe(400);
    expect(mocks.preflightBulkStockXPublish).not.toHaveBeenCalled();
  });
});
