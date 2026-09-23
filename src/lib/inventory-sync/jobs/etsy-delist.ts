import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import type { getEtsyAuthorizedSession } from "@/lib/marketplace/adapters/etsy/session";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";

export const etsyDelistDeps = { session: async (input: Parameters<typeof getEtsyAuthorizedSession>[0]) =>
  (await import("@/lib/marketplace/adapters/etsy/session")).getEtsyAuthorizedSession(input) };
const INACTIVE_STATES = new Set(["inactive", "expired", "removed", "unavailable"]);

/** The worker owns capability, account-membership, conflict and lease gates.
 * Read before and after deactivation: a completed HTTP request alone is not
 * evidence that Etsy stopped selling the item. Ambiguity is never auto-replayed. */
export async function executeEtsyWorkerDelist(
  input: { userId: string; accountId: string; inventoryItemId: string; marketplaceListingId: string },
  db = getPrisma(),
  deps = etsyDelistDeps,
) {
  const listing = await db.marketplaceListing.findFirst({
    where: { id: input.marketplaceListingId, inventoryItemId: input.inventoryItemId,
      marketplace: "etsy", environment: ETSY_ENVIRONMENT, inventoryItem: { accountId: input.accountId } },
    include: { inventoryItem: { select: { soldSourceMarketplace: true } } },
  });
  if (!listing?.externalListingId) throw new AppError("The Etsy listing could not be found. Review it before removal.", 409, "ETSY_DELIST_LISTING_MISSING");
  if (listing.inventoryItem.soldSourceMarketplace === "etsy") return { status: "SOLD" as const, changed: false, listingId: listing.externalListingId };
  if (["SOLD", "DELISTED", "ENDED"].includes(listing.status)) return { status: listing.status as "SOLD" | "DELISTED" | "ENDED", changed: false, listingId: listing.externalListingId };
  const session = await deps.session({ userId: input.userId, accountId: input.accountId });
  const remote = await session.client.getListing(listing.externalListingId);
  if (String(remote.listing_id) !== listing.externalListingId) throw new AppError("Etsy returned a different listing. Review it before removal.", 409, "ETSY_DELIST_ID_MISMATCH");
  let state = remote.state;
  if (!INACTIVE_STATES.has(remote.state ?? "")) {
    if (remote.state !== "active") throw new AppError("Etsy listing status needs review before removal.", 409, "ETSY_DELIST_STATUS_UNKNOWN");
    await session.client.deactivateListing(session.shopId, listing.externalListingId);
    const verified = await session.client.getListing(listing.externalListingId);
    if (String(verified.listing_id) !== listing.externalListingId || !INACTIVE_STATES.has(verified.state ?? "")) {
      throw new AppError("Etsy has not confirmed removal. Check the listing before retrying.", 409, "ETSY_DELIST_OUTCOME_UNKNOWN");
    }
    state = verified.state;
  }
  const saved = await db.marketplaceListing.updateMany({
    where: { id: listing.id, updatedAt: listing.updatedAt, status: listing.status, externalListingId: listing.externalListingId },
    data: { status: "DELISTED", endedAt: new Date(), lastSyncAt: new Date(), lastError: null },
  });
  if (saved.count !== 1) throw new AppError("This Etsy listing changed during removal. Review its latest status.", 409, "ETSY_DELIST_STATE_CHANGED");
  return { status: "DELISTED" as const, changed: true, listingId: listing.externalListingId, state };
}
