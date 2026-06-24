import type { EtsyListImagesUpload } from "./client";

// Etsy listing creation flow: create a DRAFT listing, upload images, then activate
// only when explicitly requested. Drafts-first means a failed activation never
// leaves the seller without the draft, and a partial image failure is reported
// rather than aborting the whole publish. Pure orchestration over an injected
// client so it is fully unit-testable without any live Etsy call.
export type EtsyPublishClient = {
  createDraftListing(
    shopId: number | string,
    body: Record<string, unknown>,
  ): Promise<{ listing_id: number; state?: string }>;
  uploadListingImage(
    shopId: number | string,
    listingId: number | string,
    image: EtsyListImagesUpload,
  ): Promise<{ listing_image_id: number }>;
  activateListing(
    shopId: number | string,
    listingId: number | string,
  ): Promise<{ listing_id: number; state?: string }>;
};

export type EtsyPublishResult = {
  listingId: number;
  state: string;
  images: { fileName: string; ok: boolean }[];
};

export async function publishEtsyListing(args: {
  client: EtsyPublishClient;
  shopId: number | string;
  listingBody: Record<string, unknown>;
  images: EtsyListImagesUpload[];
  activate: boolean;
}): Promise<EtsyPublishResult> {
  const draft = await args.client.createDraftListing(args.shopId, args.listingBody);

  const images: { fileName: string; ok: boolean }[] = [];
  for (const image of args.images) {
    try {
      await args.client.uploadListingImage(args.shopId, draft.listing_id, image);
      images.push({ fileName: image.fileName, ok: true });
    } catch {
      // A single image failing must not abort the publish; the listing keeps the
      // images that did upload and the caller reports the gap.
      images.push({ fileName: image.fileName, ok: false });
    }
  }

  let state = draft.state ?? "draft";
  if (args.activate) {
    const activated = await args.client.activateListing(args.shopId, draft.listing_id);
    state = activated.state ?? "active";
  }

  return { listingId: draft.listing_id, state, images };
}
