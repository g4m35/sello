import type { InventoryStatus } from "@/generated/prisma/client";

type MarketplaceStatusRow = {
  status: string;
};

export type MarketplaceLifecycleSyncPrismaLike = {
  inventoryItem: {
    update(args: {
      where: { id: string };
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

export async function syncMasterStatusAfterMarketplacePublish(
  prisma: Pick<MarketplaceLifecycleSyncPrismaLike, "inventoryItem">,
  inventoryItemId: string,
) {
  await prisma.inventoryItem.update({
    where: { id: inventoryItemId },
    data: { status: "LISTED" },
  });
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
  await prisma.inventoryItem.update({
    where: { id: inventoryItemId },
    data: { status: hasActiveChannel ? "LISTED" : "DELISTED" },
  });
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
    await prisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { status: "LISTED" },
    });
    return;
  }
  if (listings.some((listing) => listing.status === "DELISTED")) {
    await prisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { status: "DELISTED" },
    });
  }
}
