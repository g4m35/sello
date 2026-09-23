import { getPrisma } from "@/lib/prisma";
import { enqueueSyncJob } from "@/lib/inventory/sync-jobs";

// A sale-removal job may already have parked while the remote listing was a
// draft. A distinct, attempt-scoped job survives that earlier result. Execute
// exclusively through the existing worker's lease, capability, conflict and
// ambiguous-outcome gates; a request handler must not race its provider writes.
export async function recoverChangedEtsyPublish(
  input: { user: { id: string }; accountId: string; itemId: string; marketplaceListingId: string; usageKey: string },
  prisma = getPrisma(),
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.itemId, accountId: input.accountId },
    select: { soldSourceMarketplace: true },
  });
  if (!item || item.soldSourceMarketplace === "etsy") return null;
  return enqueueSyncJob(prisma, {
    userId: input.user.id, accountId: input.accountId, type: "delist_marketplace_listing",
    inventoryItemId: input.itemId, marketplaceListingId: input.marketplaceListingId,
    idempotencyKey: `etsy-publish-recovery:${input.marketplaceListingId}:${input.usageKey}`,
    payload: { inventoryItemId: input.itemId, marketplaceListingId: input.marketplaceListingId,
      accountId: input.accountId, marketplace: "etsy", soldMarketplace: item.soldSourceMarketplace,
      reason: "etsy_publish_inventory_changed", useAdapter: true },
  });
}
