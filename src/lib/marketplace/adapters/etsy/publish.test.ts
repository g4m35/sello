import { describe, expect, it, vi } from "vitest";
import { publishEtsyListing } from "./publish";

function setup() {
  return {
    client: {
      createDraftListing: vi.fn().mockResolvedValue({ listing_id: 555, state: "draft" }),
      getListing: vi.fn().mockResolvedValue({ listing_id: 555, state: "draft" }),
      getListingImages: vi.fn().mockResolvedValue({ results: [] }),
      updateListing: vi.fn().mockResolvedValue({ listing_id: 555, state: "draft" }),
      uploadListingImage: vi.fn().mockResolvedValue({ listing_image_id: 1 }),
      activateListing: vi.fn().mockResolvedValue({ listing_id: 555, state: "active" }),
    },
    shopId: 1, listingBody: { title: "x" },
    images: [{ data: new Uint8Array([1]), fileName: "a.jpg", rank: 1 }],
    activate: true,
    persistDraft: vi.fn().mockResolvedValue(undefined),
    assertCanActivate: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Etsy resumable publishing", () => {
  it("saves identity before images and verifies activation", async () => {
    const args = setup();
    expect((await publishEtsyListing(args)).state).toBe("active");
    expect(args.persistDraft.mock.invocationCallOrder[0]).toBeLessThan(args.client.uploadListingImage.mock.invocationCallOrder[0]);
    expect(args.assertCanActivate.mock.invocationCallOrder[0]).toBeLessThan(args.client.activateListing.mock.invocationCallOrder[0]);
  });
  it("does no subsequent remote write when saving the draft fails", async () => {
    const args = setup(); args.persistDraft.mockRejectedValue(new Error("db offline"));
    await expect(publishEtsyListing(args)).rejects.toThrow();
    expect(args.client.uploadListingImage).not.toHaveBeenCalled();
    expect(args.client.activateListing).not.toHaveBeenCalled();
  });
  it("resumes the same draft and avoids uploading an already present image rank", async () => {
    const args = setup(); args.client.getListingImages.mockResolvedValue({ results: [{ listing_image_id: 8, rank: 1 }] });
    await publishEtsyListing({ ...args, existingListingId: "555" });
    expect(args.client.createDraftListing).not.toHaveBeenCalled();
    expect(args.client.uploadListingImage).not.toHaveBeenCalled();
    expect(args.client.activateListing).toHaveBeenCalledWith(1, 555);
  });
  it("reconciles an activation that already succeeded", async () => {
    const args = setup(); args.client.getListing.mockResolvedValue({ listing_id: 555, state: "active" });
    expect((await publishEtsyListing({ ...args, existingListingId: "555" })).state).toBe("active");
    expect(args.client.createDraftListing).not.toHaveBeenCalled();
    expect(args.client.activateListing).not.toHaveBeenCalled();
  });
  it("does not activate after an image failure", async () => {
    const args = setup(); args.client.uploadListingImage.mockRejectedValue(new Error("image failed"));
    await expect(publishEtsyListing(args)).rejects.toThrow();
    expect(args.client.activateListing).not.toHaveBeenCalled();
  });
  it("does not activate inventory sold during upload", async () => {
    const args = setup(); args.assertCanActivate.mockRejectedValue(new Error("sold"));
    await expect(publishEtsyListing(args)).rejects.toThrow("sold");
    expect(args.client.activateListing).not.toHaveBeenCalled();
  });
  it.each([undefined, "inactive", "sold_out"])("refuses unverified draft state %s", async (state) => {
    const args = setup(); args.client.getListing.mockResolvedValue({ listing_id: 555, state });
    await expect(publishEtsyListing({ ...args, existingListingId: "555" })).rejects.toThrow();
    expect(args.client.activateListing).not.toHaveBeenCalled();
  });
  it("never assumes activation succeeded on missing state", async () => {
    const args = setup(); args.client.activateListing.mockResolvedValue({ listing_id: 555 });
    await expect(publishEtsyListing(args)).rejects.toThrow("did not confirm");
  });
});
