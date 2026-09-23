import type { InventoryStatus } from "@/generated/prisma/client";

type MarketplaceStatusRow = {
  status: string;
};

export type MarketplaceLifecycleSyncPrismaLike = {
  inventoryItem: {
    update(args: {
      where: { id: string; status: { not: "SOLD" }; soldAt: null; soldSourceMarketplace: null };
      data: { status: InventoryStatus };
    }): Promise<unknown>;
  };
  marketplaceListing: {
    findMany(args: {
      where: { inventoryItemId: string };
      select: { status: true };
    }): Promise<MarketplaceStatusRow[]>;
  };
};

const activeMarketplaceStatuses = new Set(["QUEUED", "LISTING", "LISTED"]);

// The condition is evaluated by the database at write time. A pre-read followed
// by an unconditional update can race a sale and make sold inventory live again.
// soldAt/source also protect older records whose displayed status was clobbered.
async function updateUnsoldStatus(
  prisma: Pick<MarketplaceLifecycleSyncPrismaLike, "inventoryItem">,
  inventoryItemId: string,
  status: InventoryStatus,
) {
  try {
    await prisma.inventoryItem.update({
      where: { id: inventoryItemId, status: { not: "SOLD" }, soldAt: null, soldSourceMarketplace: null },
      data: { status },
    });
  } catch (error) {
    // Prisma update's conditional unique lookup matched no unsold item. The
    // lifecycle projection is obsolete after a sale (or after item deletion).
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") return;
    throw error;
  }
}

export async function syncMasterStatusAfterMarketplacePublish(
  prisma: Pick<MarketplaceLifecycleSyncPrismaLike, "inventoryItem">,
  inventoryItemId: string,
) {
  await updateUnsoldStatus(prisma, inventoryItemId, "LISTED");
}

export async function syncMasterStatusAfterMarketplaceDelist(
  prisma: MarketplaceLifecycleSyncPrismaLike,
  inventoryItemId: string,
) {
  const listings = await prisma.marketplaceListing.findMany({
    where: { inventoryItemId },
    select: { status: true },
  });
  const hasActiveChannel = listings.some((listing) =>
    activeMarketplaceStatuses.has(listing.status),
  );
  await updateUnsoldStatus(prisma, inventoryItemId, hasActiveChannel ? "LISTED" : "DELISTED");
}

export async function syncMasterStatusAfterMarketplaceCleanup(
  prisma: MarketplaceLifecycleSyncPrismaLike,
  inventoryItemId: string,
) {
  const listings = await prisma.marketplaceListing.findMany({
    where: { inventoryItemId },
    select: { status: true },
  });
  const hasActiveChannel = listings.some((listing) =>
    activeMarketplaceStatuses.has(listing.status),
  );
  if (hasActiveChannel) {
    await updateUnsoldStatus(prisma, inventoryItemId, "LISTED");
    return;
  }
  if (listings.some((listing) => listing.status === "DELISTED")) {
    await updateUnsoldStatus(prisma, inventoryItemId, "DELISTED");
  }
}
