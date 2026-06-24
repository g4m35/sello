import type { MarketplaceListingStatus } from "@/generated/prisma/client";

// Maps an Etsy listing state to Sello's MarketplaceListingStatus. Unknown states
// degrade to NOT_LISTED rather than guessing a live/sold state.
export function mapEtsyListingStatus(
  state: string | null | undefined,
): MarketplaceListingStatus {
  switch (state) {
    case "active":
      return "LISTED";
    case "sold_out":
      return "SOLD";
    case "inactive":
    case "expired":
    case "removed":
    case "unavailable":
      return "DELISTED";
    case "draft":
    case "edit":
      return "NOT_LISTED";
    default:
      return "NOT_LISTED";
  }
}

export type EtsySyncClient = {
  getListing(
    listingId: number | string,
  ): Promise<{ listing_id: number; state?: string }>;
};

export async function syncEtsyListing(args: {
  client: EtsySyncClient;
  listingId: number | string;
}): Promise<{ listingId: number | string; state: string; status: MarketplaceListingStatus }> {
  const listing = await args.client.getListing(args.listingId);
  const state = listing.state ?? "unknown";
  return {
    listingId: args.listingId,
    state,
    status: mapEtsyListingStatus(listing.state),
  };
}
