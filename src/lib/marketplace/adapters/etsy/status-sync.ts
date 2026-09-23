import { AppError } from "@/lib/errors";
import { markItemSold } from "@/lib/inventory/mark-sold";
import { getPrisma } from "@/lib/prisma";
import { syncMasterStatusAfterMarketplacePublish, syncMasterStatusAfterMarketplaceDelist } from "@/lib/marketplace/lifecycle-sync";
import { isEtsyApiEnabled } from "./config";
import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import { getEtsyAuthorizedSession } from "./session";
import { syncEtsyListing } from "./sync";
import { ETSY_ENVIRONMENT } from "./types";

export async function syncEtsyListingForAccount(
  input: { userId: string; accountId: string; itemId: string },
  prisma = getPrisma(),
) {
  if (!isEtsyApiEnabled()) throw new EtsyIntegrationError(etsyErrorCodes.notEnabled, "Etsy API integration is not enabled.", 503);
  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.itemId, accountId: input.accountId },
    select: { id: true, sellerId: true },
  });
  if (!item) throw new AppError("Item not found", 404);
  const listing = await prisma.marketplaceListing.findUnique({ where: {
    inventoryItemId_marketplace_environment: { inventoryItemId: item.id, marketplace: "etsy", environment: ETSY_ENVIRONMENT },
  } });
  if (!listing?.externalListingId) return { synced: false, reason: "no_listing" };
  const session = await getEtsyAuthorizedSession({ userId: input.userId, accountId: input.accountId });
  const result = await syncEtsyListing({ client: session.client, listingId: listing.externalListingId });
  if (String(result.listingId) !== listing.externalListingId) throw new EtsyIntegrationError(etsyErrorCodes.syncFailed, "Etsy returned a different listing.", 502);
  if (!["active", "sold_out", "inactive", "expired", "removed", "unavailable", "draft", "edit"].includes(result.state)) return { synced: false, reason: "unknown_status" };
  if (result.status === "SOLD") {
    const sold = await markItemSold(prisma, {
      inventoryItemId: item.id, userId: input.userId, accountId: input.accountId,
      inventoryOwnerUserId: item.sellerId, soldMarketplace: "etsy", soldListingId: listing.externalListingId,
      sourceMarketplaceListingId: listing.id, source: "api",
    });
    if (sold.outcome === "conflict") return { synced: false, reason: "sale_conflict" };
    await prisma.marketplaceListing.updateMany({ where: { id: listing.id }, data: { status: "SOLD", lastSyncAt: new Date(), lastError: null } });
  } else {
    if (result.state === "unknown" || ["SOLD", "DELISTED", "ENDED", "DELISTING", "LISTING"].includes(listing.status)) return { synced: false, reason: "stale_or_unknown" };
    const applied = await prisma.marketplaceListing.updateMany({
      where: { id: listing.id, status: listing.status, updatedAt: listing.updatedAt,
        inventoryItem: { accountId: input.accountId, status: { notIn: ["SOLD", "ARCHIVED", "DELISTING"] }, soldAt: null, soldSourceMarketplace: null } },
      data: { status: result.status, lastSyncAt: new Date(), lastError: null },
    });
    if (applied.count !== 1) return { synced: false, reason: "stale_or_unknown" };
    if (result.status === "LISTED") await syncMasterStatusAfterMarketplacePublish(prisma, item.id);
    else if (result.status === "DELISTED") await syncMasterStatusAfterMarketplaceDelist(prisma, item.id);
  }
  return { synced: true, status: result.status, state: result.state };
}
