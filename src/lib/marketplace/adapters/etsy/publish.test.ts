import { describe, expect, it, vi } from "vitest";

import { publishEtsyListing, type EtsyPublishClient } from "./publish";

function fakeClient(overrides: Partial<EtsyPublishClient> = {}): EtsyPublishClient {
  return {
    createDraftListing: vi.fn(async () => ({ listing_id: 555, state: "draft" })),
    uploadListingImage: vi.fn(async () => ({ listing_image_id: 1 })),
    activateListing: vi.fn(async () => ({ listing_id: 555, state: "active" })),
    ...overrides,
  };
}

const images = [
  { data: new Uint8Array([1]), fileName: "a.jpg" },
  { data: new Uint8Array([2]), fileName: "b.jpg" },
];

describe("publishEtsyListing", () => {
  it("creates a draft, uploads images, and activates when requested", async () => {
    const client = fakeClient();
    const result = await publishEtsyListing({
      client,
      shopId: 1,
      listingBody: { title: "x" },
      images,
      activate: true,
    });

    expect(client.createDraftListing).toHaveBeenCalledWith(1, { title: "x" });
    expect(client.uploadListingImage).toHaveBeenCalledTimes(2);
    expect(client.activateListing).toHaveBeenCalledWith(1, 555);
    expect(result.state).toBe("active");
    expect(result.images.every((i) => i.ok)).toBe(true);
  });

  it("stays a draft when activate is false", async () => {
    const client = fakeClient();
    const result = await publishEtsyListing({
      client,
      shopId: 1,
      listingBody: {},
      images: [],
      activate: false,
    });
    expect(client.activateListing).not.toHaveBeenCalled();
    expect(result.state).toBe("draft");
  });

  it("reports a partial image failure without aborting the publish", async () => {
    const client = fakeClient({
      uploadListingImage: vi
        .fn()
        .mockResolvedValueOnce({ listing_image_id: 1 })
        .mockRejectedValueOnce(new Error("upload failed")),
    });
    const result = await publishEtsyListing({
      client,
      shopId: 1,
      listingBody: {},
      images,
      activate: false,
    });
    expect(result.images).toEqual([
      { fileName: "a.jpg", ok: true },
      { fileName: "b.jpg", ok: false },
    ]);
    expect(result.listingId).toBe(555);
  });

  it("propagates a failed draft creation so the caller never marks the item live", async () => {
    const client = fakeClient({
      createDraftListing: vi.fn(async () => {
        throw new Error("etsy draft create failed");
      }),
    });
    await expect(
      publishEtsyListing({ client, shopId: 1, listingBody: {}, images, activate: true }),
    ).rejects.toThrow();
    expect(client.activateListing).not.toHaveBeenCalled();
  });
});
