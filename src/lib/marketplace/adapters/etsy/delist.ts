// Etsy "end listing" = deactivate (move state to inactive). Etsy has no destructive
// "delete an active listing" verb; deactivation is the safe, reversible end action.
// Pure orchestration over an injected client.
export type EtsyDelistClient = {
  deactivateListing(
    shopId: number | string,
    listingId: number | string,
  ): Promise<{ listing_id: number; state?: string }>;
};

export async function deactivateEtsyListing(args: {
  client: EtsyDelistClient;
  shopId: number | string;
  listingId: number | string;
}): Promise<{ listingId: number | string; state: string }> {
  const result = await args.client.deactivateListing(args.shopId, args.listingId);
  return { listingId: args.listingId, state: result.state ?? "inactive" };
}
