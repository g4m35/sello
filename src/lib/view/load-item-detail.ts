// Server-only: imported by API route handlers. Loads the current detail
// view-model for an item so save mutations can return fresh derived state
// (readiness, status badge, marketplace/channel state) without the client
// doing a full GET. Photo signed URLs and publish attempts are intentionally
// omitted: the editor keeps its existing photos and never refreshes attempts
// on a field save.
import { getPrisma } from "@/lib/prisma";
import { mapItemDetail } from "@/lib/view/server-map";
import type { ItemDetailView } from "@/lib/view/types";

export async function loadItemDetailState(
  itemId: string,
  account: { id: string },
): Promise<ItemDetailView | null> {
  const prisma = getPrisma();
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, accountId: account.id },
    include: {
      listingDrafts: { orderBy: { updatedAt: "desc" } },
      marketplaceListings: true,
      photos: { orderBy: { position: "asc" } },
    },
  });
  if (!item) return null;
  return mapItemDetail(item, []);
}
