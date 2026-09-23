import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  findFirst: vi.fn(),
  connectionFindUnique: vi.fn(),
  listingFindUnique: vi.fn(),
  listingUpsert: vi.fn(),
  listingUpdateMany: vi.fn(),
  listingUpdate: vi.fn(),
  reserveUsage: vi.fn(),
  usageFindUnique: vi.fn(),
  settleUsage: vi.fn(),
  markUsage: vi.fn(),
  releaseUsage: vi.fn(),
  reconcileUsage: vi.fn(),
  getEtsyAuthorizedSession: vi.fn(),
  loadEtsyImagesForItem: vi.fn(),
  client: {
    createDraftListing: vi.fn(),
    getListing: vi.fn(),
    getListingImages: vi.fn(),
    updateListing: vi.fn(),
    uploadListingImage: vi.fn(),
    activateListing: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({ id: "acc-1", ownerUserId: "u1", plan: "free" }),
}));
vi.mock("@/lib/inventory/review-tasks", () => ({ createReviewTask: vi.fn().mockResolvedValue({ id: "review-1" }) }));
vi.mock("@/lib/billing/usage", () => ({ reserveUsageOrThrow: mocks.reserveUsage, markUsageWorkStarted: mocks.markUsage, releaseUsageReservation: mocks.releaseUsage, markUsageReconciliationRequired: mocks.reconcileUsage, settleUsageReservationOrRequireReconciliation: mocks.settleUsage }));
vi.mock("@/lib/marketplace/lifecycle-sync", () => ({ syncMasterStatusAfterMarketplacePublish: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    inventoryItem: { findFirst: mocks.findFirst },
    usageReservation: { findUnique: mocks.usageFindUnique },
    reviewTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    marketplaceEvent: { create: vi.fn().mockResolvedValue({}) },
    marketplaceConnection: { findUnique: mocks.connectionFindUnique },
    marketplaceListing: { findUnique: mocks.listingFindUnique, upsert: mocks.listingUpsert, updateMany: mocks.listingUpdateMany, update: mocks.listingUpdate },
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
    readinessStateId: 789,
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
    updatedAt: new Date(0),
    status: "DRAFT_READY", quantityAvailable: 1, soldAt: null, soldSourceMarketplace: null,
    productName: "Supreme Box Logo Hoodie",
    recommendedPriceCents: 42000,
    photos: [{ id: "p1", storageBucket: "b", storagePath: "p", originalName: "a.jpg", position: 0 }],
    listingDrafts: [
      {
        id: "draft-1", updatedAt: new Date(0),
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
    mocks.loadEtsyImagesForItem.mockResolvedValue([{ data: new Uint8Array([1]), fileName: "a.jpg", rank: 1 }]);
    mocks.client.getListing.mockResolvedValue({ listing_id: 555, state: "draft" });
    mocks.client.getListingImages.mockResolvedValue({ results: [] });
    mocks.client.updateListing.mockResolvedValue({ listing_id: 555, state: "draft" });
    mocks.client.uploadListingImage.mockResolvedValue({ listing_image_id: 1 });
    mocks.listingUpsert.mockResolvedValue({ id: "ml1", status: "NOT_LISTED", externalListingId: null, updatedAt: new Date(0) });
    mocks.listingUpdateMany.mockResolvedValue({ count: 1 });
    mocks.listingUpdate.mockResolvedValue({});
    mocks.usageFindUnique.mockResolvedValue({ status: "reserved", operationId: `${ITEM_ID}:etsy` });
    mocks.reserveUsage.mockResolvedValue({ reservationId: "usage-1", status: "reserved" });
    mocks.markUsage.mockResolvedValue(true);
    mocks.settleUsage.mockResolvedValue(undefined);
    mocks.releaseUsage.mockResolvedValue(undefined);
    mocks.reconcileUsage.mockResolvedValue(undefined);
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
    expect(upsertArgs.create.status).toBe("NOT_LISTED");
    expect(mocks.listingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalListingId: "555" }) }));
    expect(mocks.getEtsyAuthorizedSession).toHaveBeenCalledWith({
      userId: "u1",
      accountId: "acc-1",
    });
  });

  it("does not mark the item live and sanitizes errors when draft creation fails", async () => {
    mocks.findFirst.mockResolvedValue(readyItem());
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue(null);
    mocks.client.createDraftListing.mockRejectedValue(
      new Error("etsy 500 raw token 12345.secret stack"),
    );
    const response = await POST(postRequest(readyBody()));
    expect(mocks.listingUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_REVIEW" }) }));
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
  it("blocks sold inventory before any external action", async () => {
    mocks.findFirst.mockResolvedValue({ ...readyItem(), status: "SOLD", quantityAvailable: 0 });
    expect((await POST(postRequest(readyBody()))).status).toBe(409);
    expect(mocks.client.createDraftListing).not.toHaveBeenCalled();
  });
  it("does not call Etsy if another request wins the claim", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue(null); mocks.listingUpdateMany.mockResolvedValue({ count: 0 });
    expect((await POST(postRequest(readyBody()))).status).toBe(409);
    expect(mocks.client.createDraftListing).not.toHaveBeenCalled();
  });
  it.each(["LISTING", "NEEDS_REVIEW", "FAILED"])("never retries a %s attempt without a remote ID", async (status) => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue({ id: "ml1", status, externalListingId: null });
    expect((await POST(postRequest(readyBody()))).status).toBe(409);
    expect(mocks.client.createDraftListing).not.toHaveBeenCalled();
  });
  it("enforces quota before creating a remote draft", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue(null); mocks.reserveUsage.mockRejectedValue(new Error("quota"));
    await POST(postRequest(readyBody()));
    expect(mocks.client.createDraftListing).not.toHaveBeenCalled();
    expect(mocks.listingUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NOT_LISTED" }) }));
  });

  it("rechecks the exact item and draft versions before activation", async () => {
    mocks.findFirst.mockResolvedValueOnce(readyItem()).mockResolvedValueOnce(null);
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    expect((await POST(postRequest(readyBody()))).status).toBe(409);
    expect(mocks.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ updatedAt: new Date(0) }), include: { photos: true, listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } } }));
    expect(mocks.client.activateListing).not.toHaveBeenCalled();
  });
  it("resumes an image failure using the same draft and quota reservation", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" });
    mocks.listingFindUnique.mockResolvedValue(null);
    mocks.client.uploadListingImage.mockRejectedValueOnce(new Error("image failed"));
    expect((await POST(postRequest(readyBody()))).status).toBe(500);
    const claimMetadata = mocks.listingUpdateMany.mock.calls[0][0].data.metadata;
    const firstKey = mocks.reserveUsage.mock.calls[0][0].idempotencyKey;
    mocks.listingFindUnique.mockResolvedValue({ id: "ml1", status: "NEEDS_REVIEW", externalListingId: "555", metadata: claimMetadata, updatedAt: new Date(1) });
    expect((await POST(postRequest(readyBody()))).status).toBe(200);
    expect(mocks.client.createDraftListing).toHaveBeenCalledTimes(1);
    expect(mocks.reserveUsage.mock.calls[1][0].idempotencyKey).toBe(firstKey);
    expect(mocks.settleUsage).toHaveBeenCalledWith("usage-1", expect.any(Date), "ETSY_PUBLISH_SETTLEMENT_FAILED", expect.anything());
  });

  it("blocks activation when photos change without updating the parent item", async () => {
    mocks.findFirst.mockResolvedValueOnce(readyItem()).mockResolvedValueOnce({ ...readyItem(), photos: [] });
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    expect((await POST(postRequest(readyBody()))).status).toBe(409);
    expect(mocks.client.activateListing).not.toHaveBeenCalled();
  });

  it("keeps uncertain activation eligible for cross-marketplace removal", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    mocks.client.activateListing.mockRejectedValueOnce(new Error("activation timed out"));
    expect((await POST(postRequest(readyBody()))).status).toBe(500);
    expect(mocks.listingUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_REVIEW" }) }));
    expect(mocks.listingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalListingId: "555" }) }));
  });
  it("blocks a newer duplicate draft even if the parent version is unchanged", async () => {
    const changed = readyItem(); changed.listingDrafts[0] = { ...changed.listingDrafts[0], id: "draft-new" };
    mocks.findFirst.mockResolvedValueOnce(readyItem()).mockResolvedValueOnce(changed);
    mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    expect((await POST(postRequest(readyBody()))).status).toBe(409);
    expect(mocks.client.activateListing).not.toHaveBeenCalled();
  });

  it("keeps the reserved usage key after status sync confirms a draft", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    mocks.client.uploadListingImage.mockRejectedValueOnce(new Error("image failed"));
    await POST(postRequest(readyBody()));
    const metadata = mocks.listingUpdateMany.mock.calls[0][0].data.metadata;
    const firstKey = mocks.reserveUsage.mock.calls[0][0].idempotencyKey;
    // Sync changes only the status; reservation lifecycle remains in metadata.
    mocks.listingFindUnique.mockResolvedValue({ id: "ml1", status: "NOT_LISTED", externalListingId: "555", metadata, updatedAt: new Date(1) });
    expect((await POST(postRequest(readyBody()))).status).toBe(200);
    expect(mocks.reserveUsage.mock.calls[1][0].idempotencyKey).toBe(firstKey);
  });

  it("reconciles a settled reservation after the final listing write was lost", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    mocks.client.activateListing.mockRejectedValueOnce(new Error("timeout"));
    await POST(postRequest(readyBody()));
    const metadata = mocks.listingUpdateMany.mock.calls[0][0].data.metadata;
    mocks.listingFindUnique.mockResolvedValue({ id: "ml1", status: "NEEDS_REVIEW", externalListingId: "555", metadata, updatedAt: new Date(1) });
    mocks.usageFindUnique.mockResolvedValue({ status: "settled", operationId: `${ITEM_ID}:etsy` });
    mocks.reserveUsage.mockResolvedValue({ reservationId: "usage-1", status: "settled" });
    mocks.client.getListing.mockResolvedValue({ listing_id: 555, state: "active" });
    expect((await POST(postRequest(readyBody()))).status).toBe(200);
    expect(mocks.client.createDraftListing).toHaveBeenCalledTimes(1);
    expect(mocks.client.activateListing).toHaveBeenCalledTimes(1);
  });
  it("can retry after quota denial without reusing the denied key", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    mocks.reserveUsage.mockRejectedValueOnce(new Error("quota denied"));
    await POST(postRequest(readyBody()));
    const restored = mocks.listingUpdateMany.mock.calls.at(-1)![0].data;
    mocks.listingFindUnique.mockResolvedValue({ id: "ml1", status: "NOT_LISTED", externalListingId: null, metadata: restored.metadata, updatedAt: new Date(1) });
    expect((await POST(postRequest(readyBody()))).status).toBe(200);
    expect(mocks.reserveUsage.mock.calls[1][0].idempotencyKey).not.toBe(mocks.reserveUsage.mock.calls[0][0].idempotencyKey);
  });

  it("uses a fresh reservation after a released draft save and verifies it is still a draft", async () => {
    mocks.findFirst.mockResolvedValue(readyItem()); mocks.connectionFindUnique.mockResolvedValue({ id: "conn" }); mocks.listingFindUnique.mockResolvedValue(null);
    await POST(postRequest(readyBody({ activate: false })));
    const metadata = mocks.listingUpdateMany.mock.calls[0][0].data.metadata;
    const firstKey = mocks.reserveUsage.mock.calls[0][0].idempotencyKey;
    mocks.listingFindUnique.mockResolvedValue({ id: "ml1", status: "NEEDS_REVIEW", externalListingId: "555", metadata, updatedAt: new Date(1) });
    mocks.usageFindUnique.mockResolvedValue({ status: "released", operationId: `${ITEM_ID}:etsy` });
    expect((await POST(postRequest(readyBody()))).status).toBe(200);
    expect(mocks.reserveUsage.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
    expect(mocks.client.getListing).toHaveBeenCalledWith("555");
    expect(mocks.client.createDraftListing).toHaveBeenCalledTimes(1);
  });

});
