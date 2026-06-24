import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  itemFindFirst: vi.fn(),
  listingFindUnique: vi.fn(),
  listingUpdate: vi.fn(),
  getEtsyAuthorizedSession: vi.fn(),
  deactivateListing: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    inventoryItem: { findFirst: mocks.itemFindFirst },
    marketplaceListing: { findUnique: mocks.listingFindUnique, update: mocks.listingUpdate },
  }),
}));
vi.mock("@/lib/marketplace/adapters/etsy/session", () => ({
  getEtsyAuthorizedSession: mocks.getEtsyAuthorizedSession,
}));

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/marketplaces/etsy/delist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Etsy delist route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_API_ENABLED = "true";
    process.env.ETSY_DELIST_EMAILS = "seller@example.com";
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    mocks.itemFindFirst.mockResolvedValue({ id: ITEM_ID });
    mocks.deactivateListing.mockResolvedValue({ listing_id: 999, state: "inactive" });
    mocks.getEtsyAuthorizedSession.mockResolvedValue({
      client: { deactivateListing: mocks.deactivateListing },
      shopId: 777,
    });
  });
  afterEach(() => {
    delete process.env.ETSY_API_ENABLED;
    delete process.env.ETSY_DELIST_EMAILS;
  });

  it("fails closed when not on the delist allowlist", async () => {
    process.env.ETSY_DELIST_EMAILS = "other@example.com";
    const response = await POST(postRequest({ itemId: ITEM_ID, confirm: true }));
    expect(response.status).toBe(403);
  });

  it("requires explicit confirmation", async () => {
    const response = await POST(postRequest({ itemId: ITEM_ID, confirm: false }));
    expect(response.status).toBe(400);
  });

  it("is a safe no-op when there is no live Etsy listing", async () => {
    mocks.listingFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest({ itemId: ITEM_ID, confirm: true }));
    expect((await response.json()).reason).toBe("no_active_listing");
    expect(mocks.deactivateListing).not.toHaveBeenCalled();
  });

  it("skips an already-ended listing", async () => {
    mocks.listingFindUnique.mockResolvedValue({
      id: "ml",
      externalListingId: "999",
      status: "DELISTED",
    });
    const response = await POST(postRequest({ itemId: ITEM_ID, confirm: true }));
    expect((await response.json()).reason).toBe("already_ended");
    expect(mocks.deactivateListing).not.toHaveBeenCalled();
  });

  it("deactivates a live listing and marks it DELISTED", async () => {
    mocks.listingFindUnique.mockResolvedValue({
      id: "ml",
      externalListingId: "999",
      status: "LISTED",
    });
    const response = await POST(postRequest({ itemId: ITEM_ID, confirm: true }));
    expect(response.status).toBe(200);
    expect(mocks.deactivateListing).toHaveBeenCalledWith(777, "999");
    expect(mocks.listingUpdate).toHaveBeenCalledWith({
      where: { id: "ml" },
      data: { status: "DELISTED", lastSyncAt: expect.any(Date), lastError: null },
    });
  });

  it("rejects a different seller's item", async () => {
    mocks.itemFindFirst.mockResolvedValue(null);
    const response = await POST(postRequest({ itemId: ITEM_ID, confirm: true }));
    expect(response.status).toBe(404);
    expect(mocks.deactivateListing).not.toHaveBeenCalled();
  });
});
