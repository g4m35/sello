import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getActiveAccount: vi.fn(),
  requireSupabaseUser: vi.fn(),
  executeEbayDelist: vi.fn(),
  executeStockXDelist: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

vi.mock("@/lib/marketplace/delist-handler", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/marketplace/delist-handler")
  >();
  return {
    ...actual,
    executeEbayDelist: mocks.executeEbayDelist,
    executeStockXDelist: mocks.executeStockXDelist,
  };
});

import { POST } from "./route";

describe("delist API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EBAY_DELIST_EMAILS", "allowed@example.com");
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-1",
      ownerUserId: "user-1",
      plan: "free",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects authenticated sellers outside the delist alpha before side effects", async () => {
    const prismaWrite = vi.fn();
    const outboundAdapter = vi.fn();
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({});
    mocks.executeEbayDelist.mockImplementationOnce(async () => {
      prismaWrite();
      outboundAdapter();
      throw new Error("delist should not execute");
    });

    const response = await POST(
      new Request("http://localhost/api/listings/delist", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          confirmLiveDelist: true,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      error: {
        code: "EBAY_DELIST_ALPHA_ONLY",
        message:
          "Live eBay delisting is currently enabled for selected alpha accounts.",
      },
    });
    expect(mocks.executeEbayDelist).not.toHaveBeenCalled();
    expect(mocks.executeStockXDelist).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(prismaWrite).not.toHaveBeenCalled();
    expect(outboundAdapter).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected handler error (no raw DB/provider text)", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    mocks.getPrisma.mockReturnValue({});
    const raw = new Error(
      "PrismaClientKnownRequestError: column of type 'void'. token=tok_live_secret",
    );
    raw.name = "PrismaClientKnownRequestError";
    mocks.executeEbayDelist.mockRejectedValue(raw);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new Request("http://localhost/api/listings/delist", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          confirmLiveDelist: true,
        }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body).error.code).toBe("DELIST_FAILED");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("void");
    expect(body).not.toContain("tok_live_secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("tok_live_secret");
    consoleError.mockRestore();
  });

  it("routes StockX delist without the eBay alpha allowlist", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({});
    mocks.executeStockXDelist.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      status: "delisted",
      code: "STOCKX_DELIST_SUCCEEDED",
      marketplace: "stockx",
      environment: "production",
      listingId: "stockx-listing-1",
      marketplaceListingId: "listing-1",
      publishAttemptId: "attempt-1",
    });

    const response = await POST(
      new Request("http://localhost/api/listings/delist", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          marketplace: "stockx",
          confirmLiveDelist: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.executeEbayDelist).not.toHaveBeenCalled();
    expect(mocks.executeStockXDelist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        inventoryItemId: "11111111-1111-4111-8111-111111111111",
        confirmLiveDelist: true,
      }),
    );
  });
});
