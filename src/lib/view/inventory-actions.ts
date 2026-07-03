import type { FeatureAccess, FeatureEntitlement } from "@/lib/auth/feature-access";
import type { ItemLifecycleState } from "@/lib/lifecycle/item-status";
import type { ChannelStateView, ItemView } from "@/lib/view/types";

// Pure, client-safe helpers that decide which marketplace actions are honest to
// show. They never import the server-only entitlement module; callers pass the
// already-resolved FeatureAccess and supply alpha copy from useFeatureAccess().

export type PublishAction = {
  mode: "publish_live" | "preview";
  label: string;
  restricted: boolean;
  entitlement: FeatureEntitlement;
  confirm?: string;
};

export function resolvePublishAction(access: FeatureAccess): PublishAction {
  if (access.liveEbayPublish) {
    return {
      mode: "publish_live",
      label: "Publish to eBay",
      restricted: false,
      entitlement: "liveEbayPublish",
      confirm: "I understand this will create a live eBay listing.",
    };
  }
  return {
    mode: "preview",
    label: "Preview eBay listing",
    restricted: true,
    entitlement: "liveEbayPublish",
  };
}

export type DelistAction = {
  available: boolean;
  restricted: boolean;
  label?: string;
  entitlement?: FeatureEntitlement;
};

export function isLiveEbayChannel(channel: ChannelStateView | null): boolean {
  return Boolean(
    channel &&
      channel.status === "published" &&
      channel.externalOfferId &&
      channel.externalListingId,
  );
}

export function isLiveStockXChannel(channel: ChannelStateView | null): boolean {
  return Boolean(
    channel &&
      (channel.status === "published" || channel.status === "publishing") &&
      channel.externalListingId,
  );
}

export function resolveDelistAction(
  channel: ChannelStateView | null,
  access: FeatureAccess,
): DelistAction {
  if (!isLiveEbayChannel(channel)) return { available: false, restricted: false };
  if (!access.ebayDelist) {
    return { available: false, restricted: true, entitlement: "ebayDelist" };
  }
  return { available: true, restricted: false, label: "End eBay listing" };
}

export function ebayListingUrl(externalListingId: string | null | undefined): string | null {
  if (!externalListingId) return null;
  return `https://www.ebay.com/itm/${encodeURIComponent(externalListingId)}`;
}

export function ebayChannelUrl(channel: ChannelStateView | null): string | null {
  if (!channel || channel.status !== "published") return null;
  return ebayListingUrl(channel.externalListingId);
}

export function stockxChannelUrl(channel: ChannelStateView | null): string | null {
  if (!channel || !isLiveStockXChannel(channel)) return null;
  return channel.externalUrl ?? null;
}

export type RemoveAction =
  | { kind: "archive"; label: "Archive listing" }
  | { kind: "delete"; label: "Delete draft" };

const ARCHIVE_STATES: ReadonlySet<ItemLifecycleState> = new Set([
  "active",
  "sold",
  "delisted",
]);

export function resolveRemoveAction(item: {
  lifecycleState: ItemLifecycleState;
}): RemoveAction {
  if (ARCHIVE_STATES.has(item.lifecycleState)) {
    return { kind: "archive", label: "Archive listing" };
  }
  return { kind: "delete", label: "Delete draft" };
}

// Raw MarketplaceListingStatus values that mean a live or in-flight marketplace
// artifact exists. Deleting the inventory item while one of these is present
// would orphan or silently drop a real listing, so the server refuses.
export const LIVE_MARKETPLACE_STATUSES: readonly string[] = [
  "QUEUED",
  "LISTING",
  "LISTED",
  "DELISTING",
];

export function isLiveMarketplaceStatus(status: string): boolean {
  return LIVE_MARKETPLACE_STATUSES.includes(status);
}

// Inventory search across the fields a seller actually thinks in: product
// title, brand, category, the human status label, lifecycle state, and id.
export type SearchableItem = Pick<
  ItemView,
  "id" | "title" | "brand" | "category" | "statusLabel" | "lifecycleState"
>;

export function matchesItemSearch(item: SearchableItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    item.title,
    item.brand ?? "",
    item.category,
    item.statusLabel,
    item.lifecycleState,
    item.id,
  ].some((field) => field.toLowerCase().includes(needle));
}

export type DeleteBlock = { itemId: string; reason: "LIVE_MARKETPLACE_LISTING" };

export function partitionDeletable(
  items: { itemId: string; statuses: string[] }[],
): { deletable: string[]; blocked: DeleteBlock[] } {
  const deletable: string[] = [];
  const blocked: DeleteBlock[] = [];
  for (const item of items) {
    if (item.statuses.some(isLiveMarketplaceStatus)) {
      blocked.push({ itemId: item.itemId, reason: "LIVE_MARKETPLACE_LISTING" });
    } else {
      deletable.push(item.itemId);
    }
  }
  return { deletable, blocked };
}
