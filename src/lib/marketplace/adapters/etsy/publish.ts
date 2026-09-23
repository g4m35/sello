import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import type { EtsyListImagesUpload } from "./client";

export type EtsyPublishClient = {
  createDraftListing(shopId: number | string, body: Record<string, unknown>): Promise<{ listing_id: number; state?: string }>;
  getListing(listingId: number | string): Promise<{ listing_id: number; state?: string }>;
  getListingImages(listingId: number | string): Promise<{ results: { listing_image_id: number; rank: number }[] }>;
  updateListing(shopId: number | string, listingId: number | string, body: Record<string, unknown>): Promise<{ listing_id: number; state?: string }>;
  uploadListingImage(shopId: number | string, listingId: number | string, image: EtsyListImagesUpload): Promise<{ listing_image_id: number }>;
  activateListing(shopId: number | string, listingId: number | string): Promise<{ listing_id: number; state?: string }>;
};

export type EtsyPublishResult = {
  listingId: number;
  state: string;
  images: { fileName: string; ok: boolean }[];
};

// The caller owns a durable exclusive claim. A new ID must be stored before
// subsequent remote writes, so retries can resume that exact draft.
export async function publishEtsyListing(args: {
  client: EtsyPublishClient;
  shopId: number | string;
  listingBody: Record<string, unknown>;
  images: EtsyListImagesUpload[];
  activate: boolean;
  existingListingId?: string | null;
  requireExistingActive?: boolean;
  persistDraft: (listingId: number) => Promise<void>;
  assertCanActivate: () => Promise<void>;
}): Promise<EtsyPublishResult> {
  if (args.requireExistingActive && !args.existingListingId) throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "A settled publish needs a saved Etsy listing to reconcile.", 409);
  const draft = args.existingListingId
    ? await args.client.getListing(args.existingListingId)
    : await args.client.createDraftListing(args.shopId, args.listingBody);
  if (!Number.isSafeInteger(draft.listing_id) || draft.listing_id <= 0 ||
      (args.existingListingId && String(draft.listing_id) !== args.existingListingId)) {
    throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "Etsy listing identity could not be verified. Review this attempt before retrying.", 409);
  }
  await args.persistDraft(draft.listing_id);
  // An activation timeout may have succeeded remotely. Reconcile, never create
  // or reactivate another listing based on a missing local success response.
  if (draft.state === "active") {
    await args.assertCanActivate();
    return { listingId: draft.listing_id, state: "active", images: [] };
  }
  if (args.requireExistingActive || draft.state !== "draft") {
    throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "Only a verified Etsy draft can be activated. Review this listing in Etsy.", 409);
  }
  if (args.existingListingId) {
    const body = { ...args.listingBody };
    delete body.state;
    await args.client.updateListing(args.shopId, draft.listing_id, body);
  }
  const existingRanks = args.existingListingId
    ? new Set((await args.client.getListingImages(draft.listing_id)).results.map((image) => image.rank))
    : new Set<number>();
  const images: EtsyPublishResult["images"] = [];
  for (const [index, image] of args.images.entries()) {
    const rank = image.rank ?? index + 1;
    if (!existingRanks.has(rank)) {
      // A failed upload keeps the saved draft recoverable, but must never
      // silently activate a listing with missing seller photos.
      await args.client.uploadListingImage(args.shopId, draft.listing_id, { ...image, rank });
    }
    images.push({ fileName: image.fileName, ok: true });
  }
  if (args.activate) {
    if (!images.length) throw new EtsyIntegrationError(etsyErrorCodes.imageUploadFailed, "Add at least one image before activating Etsy.", 422);
    await args.assertCanActivate();
    const activated = await args.client.activateListing(args.shopId, draft.listing_id);
    if (activated.listing_id !== draft.listing_id || activated.state !== "active") {
      throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "Etsy did not confirm activation. Sync this saved listing before retrying.", 409);
    }
    await args.assertCanActivate();
    return { listingId: draft.listing_id, state: "active", images };
  }
  return { listingId: draft.listing_id, state: "draft", images };
}
