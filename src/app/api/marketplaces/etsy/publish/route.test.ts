import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  findFirst: vi.fn(),
  connectionFindUnique: vi.fn(),
  listingFindUnique: vi.fn(),
  listingUpsert: vi.fn(),
  getEtsyAuthorizedSession: vi.fn(),
  loadEtsyImagesForItem: vi.fn(),
  client: {
    createDraftListing: vi.fn(),
    uploadListingImage: vi.fn(),
    activateListing: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    inventoryItem: { findFirst: mocks.findFirst },
    marketplaceConnection: { findUnique: mocks.connectionFindUnique },
    marketplaceListing: { findUnique: mocks.listingFindUnique, upsert: mocks.listingUpsert },
  }),
}));
vi.mock("@/lib/marketplace/adapters/etsy/session", () => ({
  getEtsyAuthorizedSession: mocks.getEtsyAuthorizedSession,
}));
vi.mock("@/lib/marketplace/adapters/etsy/media", () => ({
  loadEtsyImagesForItem: mocks.loadEtsyImagesForItem,
}));

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function readyBody(overrides: Record<string, unknown> = {}) {
  return {
    itemId: ITEM_ID,
    confirm: true,
    activate: true,
    taxonomyId: 1234,
    shippingProfileId: 5678,
    returnPolicyId: 9012,
    whoMade: "someone_else",
    whenMade: "2010_2019",
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/marketplaces/etsy/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readyItem() {
  return {
    id: ITEM_ID,
    productName: "Supreme Box Logo Hoodie",
    recommendedPriceCents: 42000,
    photos: [{ id: "p1", storageBucket: "b", storagePath: "p", originalName: "a.jpg", position: 0 }],
    listingDrafts: [
      {
        title: "Supreme Box Logo Hoodie Heather Grey",
        description: "Authentic bogo hoodie in great condition.",
        recommendedPriceCents: 42000,
        marketplaceDrafts: { etsy: { tags: ["supreme", "box logo"] } },
      },
    ],
  };
}

describe("Etsy publish route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_API_ENABLED = "true";
    process.env.ETSY_PUBLISH_EMAILS = "seller@example.com";
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    mocks.loadEtsyImagesForItem.mockResolvedValue([]);
    mocks.client.createDraftListing.mockResolvedValue({ listing_id: 555, state: "draft" });
    mocks.client.activateListing.mockResolvedValue({ listing_id: 555, state: "active" });
    mocks.getEtsyAuthorizedSession.mockResolvedValue({ client: mocks.client, shopId: 777 });
  });
  afterEach(() => {
    delete process.env.ETSY_API_ENABLED;
    delete process.env.ETSY_PUBLISH_EMAILS;
  });

  it("fails closed when the API switch is off", async () => {
    process.env.ETSY_API_ENABLED = "false";
    const response = await POST(postRequest(readyBody()));
    expect(response.status).toBe(503);
    expect(mocks.getEtsyAuthorizedSession).not.toHaveBeenCalled();
  });

  it("rejects a seller not on the publish allowlist", async () => {
    process.env.ETSY_PUBLISH_EMAILS = "other@example.com";
    const response = await POST(postRequest(readyBody()));
    expect(response.status).toBe(403);
    expect(mocks.getEtsyAuthorizedSession).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation", async () => {
    const response = await POST(postRequest(readyBody({ confirm: false })));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("ETSY_CONFIRMATION_REQUIRED");
  });

  it("returns missing connection (not an error) and keeps copy-ready when not connected", async () => {
    mocks.findFirst.mockResolvedValue(readyItem());
    mocks.connectionFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(readyBody()));
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.missing).toContain("connection");
    expect(payload.copyReadyAvailable).toBe(true);
    expect(mocks.getEtsyAuthorizedSession).not.toHaveBeenCalled();
  });

  it("blocks publish with the exact missing Etsy-specific reason", async () => {
    mocks.findFirst.mockResolvedValue(readyItem());
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    const response = await POST(postRequest(readyBody({ shippingProfileId: null })));
    expect(response.status).toBe(422);
    expect((await response.json()).missing).toContain("shipping_profile");
    expect(mocks.client.createDraftListing).not.toHaveBeenCalled();
  });

  it("skips when an Etsy listing is already live (idempotent)", async () => {
    mocks.findFirst.mockResolvedValue(readyItem());
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue({
      id: "ml1",
      externalListingId: "999",
      status: "LISTED",
    });
    const response = await POST(postRequest(readyBody()));
    const payload = await response.json();
    expect(payload.skipped).toBe(true);
    expect(payload.code).toBe("ETSY_ALREADY_PUBLISHED");
    expect(mocks.client.createDraftListing).not.toHaveBeenCalled();
  });

  it("creates the draft, activates, and persists a LISTED artifact", async () => {
    mocks.findFirst.mockResolvedValue(readyItem());
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(readyBody()));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.client.createDraftListing).toHaveBeenCalledTimes(1);
    expect(mocks.client.activateListing).toHaveBeenCalledWith(777, 555);
    expect(payload.listingId).toBe(555);
    expect(payload.listingUrl).toBe("https://www.etsy.com/listing/555");
    const upsertArgs = mocks.listingUpsert.mock.calls[0][0];
    expect(upsertArgs.create.marketplace).toBe("etsy");
    expect(upsertArgs.create.status).toBe("LISTED");
    expect(upsertArgs.create.externalListingId).toBe("555");
  });

  it("does not mark the item live and sanitizes errors when draft creation fails", async () => {
    mocks.findFirst.mockResolvedValue(readyItem());
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue(null);
    mocks.client.createDraftListing.mockRejectedValue(
      new Error("etsy 500 raw token 12345.secret stack"),
    );
    const response = await POST(postRequest(readyBody()));
    expect(mocks.listingUpsert).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
