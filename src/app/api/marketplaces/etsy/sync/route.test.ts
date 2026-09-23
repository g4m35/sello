import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  itemFindFirst: vi.fn(),
  listingFindUnique: vi.fn(),
  listingUpdate: vi.fn(),
  markSold: vi.fn(),
  getEtsyAuthorizedSession: vi.fn(),
  getListing: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({ id: "acc-1", ownerUserId: "u1", plan: "free" }),
}));
vi.mock("@/lib/inventory/mark-sold", () => ({ markItemSold: mocks.markSold }));
vi.mock("@/lib/marketplace/lifecycle-sync", () => ({ syncMasterStatusAfterMarketplacePublish: vi.fn(), syncMasterStatusAfterMarketplaceDelist: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    inventoryItem: { findFirst: mocks.itemFindFirst },
    marketplaceListing: { findUnique: mocks.listingFindUnique, updateMany: mocks.listingUpdate },
  }),
}));
vi.mock("@/lib/marketplace/adapters/etsy/session", () => ({
  getEtsyAuthorizedSession: mocks.getEtsyAuthorizedSession,
}));

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/marketplaces/etsy/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Etsy sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markSold.mockResolvedValue({ outcome: "marked_sold" });
    mocks.listingUpdate.mockResolvedValue({ count: 1 });
    process.env.ETSY_API_ENABLED = "true";
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    mocks.itemFindFirst.mockResolvedValue({ id: ITEM_ID });
    mocks.getListing.mockResolvedValue({ listing_id: 999, state: "sold_out" });
    mocks.getEtsyAuthorizedSession.mockResolvedValue({
      client: { getListing: mocks.getListing },
      shopId: 777,
    });
  });
  afterEach(() => {
    delete process.env.ETSY_API_ENABLED;
  });

  it("fails closed when the API switch is off", async () => {
    process.env.ETSY_API_ENABLED = "false";
    const response = await POST(postRequest({ itemId: ITEM_ID }));
    expect(response.status).toBe(503);
    expect(mocks.getEtsyAuthorizedSession).not.toHaveBeenCalled();
  });

  it("returns synced:false when there is no Etsy listing", async () => {
    mocks.listingFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest({ itemId: ITEM_ID }));
    expect((await response.json())).toEqual({ synced: false, reason: "no_listing" });
  });

  it("syncs the listing status and updates the artifact", async () => {
    mocks.listingFindUnique.mockResolvedValue({ id: "ml", externalListingId: "999" });
    const response = await POST(postRequest({ itemId: ITEM_ID }));
    const payload = await response.json();
    expect(payload).toEqual({ synced: true, status: "SOLD", state: "sold_out" });
    expect(mocks.listingUpdate).toHaveBeenCalledWith({
      where: { id: "ml" },
      data: { status: "SOLD", lastSyncAt: expect.any(Date), lastError: null },
    });
    expect(mocks.getEtsyAuthorizedSession).toHaveBeenCalledWith({
      userId: "u1",
      accountId: "acc-1",
    });
  });
  it("does not overwrite a conflicting sale source", async () => {
    mocks.listingFindUnique.mockResolvedValue({ id: "ml", externalListingId: "999" });
    mocks.markSold.mockResolvedValue({ outcome: "conflict" });
    const payload = await (await POST(postRequest({ itemId: ITEM_ID }))).json();
    expect(payload).toEqual({ synced: false, reason: "sale_conflict" });
    expect(mocks.listingUpdate).not.toHaveBeenCalled();
  });
  it("cannot revive a sold listing from a stale active response", async () => {
    mocks.listingFindUnique.mockResolvedValue({ id: "ml", externalListingId: "999", status: "SOLD" });
    mocks.getListing.mockResolvedValue({ listing_id: 999, state: "active" });
    expect((await (await POST(postRequest({ itemId: ITEM_ID }))).json()).synced).toBe(false);
    expect(mocks.listingUpdate).not.toHaveBeenCalled();
  });
  it("never accepts a different listing identity", async () => {
    mocks.listingFindUnique.mockResolvedValue({ id: "ml", externalListingId: "999", status: "LISTED" });
    mocks.getListing.mockResolvedValue({ listing_id: 888, state: "sold_out" });
    expect((await POST(postRequest({ itemId: ITEM_ID }))).status).toBe(502);
    expect(mocks.markSold).not.toHaveBeenCalled();
  });

  it("treats unavailable as an ended listing", async () => {
    mocks.listingFindUnique.mockResolvedValue({ id: "ml", externalListingId: "999", status: "LISTED", updatedAt: new Date(0) });
    mocks.getListing.mockResolvedValue({ listing_id: 999, state: "unavailable" });
    expect(await (await POST(postRequest({ itemId: ITEM_ID }))).json()).toEqual({ synced: true, status: "DELISTED", state: "unavailable" });
  });

});
