import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(() => ({})),
  requireSupabaseUser: vi.fn(),
  executeBulkEbayDelist: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/marketplace/bulk-delist", async (orig) => {
  const actual = await orig<typeof import("@/lib/marketplace/bulk-delist")>();
  return { ...actual, executeBulkEbayDelist: mocks.executeBulkEbayDelist };
});

import { POST } from "./route";

const ITEM = "11111111-1111-4111-8111-111111111111";

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
});
