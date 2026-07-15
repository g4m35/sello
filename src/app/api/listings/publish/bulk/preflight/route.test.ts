import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  resolveRuntimeEntitlements: vi.fn(),
  preflightBulkEbayPublish: vi.fn(),
  preflightBulkStockXPublish: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/auth/feature-access", () => ({
  resolveRuntimeEntitlements: mocks.resolveRuntimeEntitlements,
}));
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

function entitlements(account: { id: string; ownerUserId: string; plan: string }, liveEbayPublish: boolean) {
  return {
    account,
    access: { liveEbayPublish },
    decisions: {},
    plan: account.plan,
    limits: {},
    features: {},
  };
}

describe("bulk publish preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "allowed@example.com");
    const account = { id: "acc-1", ownerUserId: "user-1", plan: "free" };
    mocks.getActiveAccount.mockResolvedValue(account);
    mocks.resolveRuntimeEntitlements.mockImplementation(async (user: { email?: string | null }) =>
      entitlements(account, user.email === "allowed@example.com"),
    );
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
      req({ itemIds: Array.from({ length: 11 }, (_, i) => u(i + 1)) }),
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
      req({
        itemIds: Array.from({ length: 11 }, (_, i) => u(i + 1)),
        marketplace: "stockx",
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.preflightBulkStockXPublish).not.toHaveBeenCalled();
  });

  it("uses the commercially effective plan rather than the stored paid tier", async () => {
    const account = { id: "acc-pro", ownerUserId: "user-1", plan: "pro" };
    mocks.resolveRuntimeEntitlements.mockResolvedValue(
      entitlements(account, false),
    );
    mocks.resolveRuntimeEntitlements.mockResolvedValueOnce({
      ...entitlements(account, false),
      plan: "free",
    });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });

    const res = await POST(req({ itemIds: Array.from({ length: 11 }, (_, i) => u(i + 1)) }));

    expect(res.status).toBe(400);
    expect(mocks.preflightBulkEbayPublish).not.toHaveBeenCalled();
  });
});
