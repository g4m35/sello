import type { Flaw, Measurement } from "@/lib/ai/listing-draft";
import type { ItemLifecycleState } from "@/lib/lifecycle/item-status";

/**
 * Design-language status used by the Counter UI badges/dots. These are the six
 * visual states from the design system. They are DERIVED from the real backend
 * enums (InventoryStatus, MarketplaceListingStatus, PublishAttemptStatus) — see
 * lib/view/status.ts. "delisted" is explicit so ended marketplace listings are
 * never softened into draft/not-published language. "noimpl" reflects an adapter
 * whose publish capability is false (publishing is intentionally not implemented yet).
 */
export type DesignStatus =
  | "draft"
  | "ready"
  | "publishing"
  | "published"
  | "delisted"
  | "failed"
  | "noimpl";

export type ChannelStateView = {
  marketplace: string;
  name: string;
  status: DesignStatus;
  publishImplemented: boolean;
  environment: string | null;
  sku: string | null;
  externalOfferId: string | null;
  externalListingId: string | null;
  externalUrl?: string | null;
  lastError: string | null;
};

export type ReadinessCheckView = {
  id: string;
  title: string;
  sub: string;
  state: "done" | "warn" | "miss";
  blocking: boolean;
};

export type ItemView = {
  id: string;
  title: string;
  productName: string;
  brand: string | null;
  category: string;
  condition: string;
  size: string | null;
  colorway: string | null;
  priceCents: number | null;
  status: DesignStatus;
  lifecycleState: ItemLifecycleState;
  statusLabel: string;
  /** True when all blocking readiness checks pass (the item can be marked ready). */
  ready: boolean;
  /** Number of blocking readiness checks still missing (0 when ready). */
  missingCount: number;
  photoCount: number;
  coverImage?: string | null;
  updatedAt: string;
  draftId: string | null;
  channels: ChannelStateView[];
};

export type AttemptView = {
  id: string;
  itemId: string;
  itemTitle: string;
  marketplace: string;
  marketplaceName: string;
  environment: string;
  status: DesignStatus;
  rawStatus: string;
  listingStatus: string;
  time: string;
  createdAt: string;
  updatedAt: string | null;
  durationMs: number | null;
  reason: string | null;
  code: string | null;
  sku: string | null;
  externalOfferId: string | null;
  externalListingId: string | null;
  listingLastError: string | null;
  failedStep: string | null;
  ebayErrorStatus: number | null;
  ebayErrorMessage: string | null;
  bulkRunId: string | null;
};

export type EbayOrphanArtifactView = {
  sku: string;
  inventoryItemFound: boolean;
  offers: Array<{
    offerId: string | null;
    status: string | null;
    listingId: string | null;
    listingStatus: string | null;
  }>;
  liveListingFound: boolean;
  cleanupAvailable: boolean;
  checkedAt: string;
};

export type ReadinessView = {
  ready: boolean;
  pct: number;
  doneCount: number;
  totalCount: number;
  checks: ReadinessCheckView[];
};

export type StockXMatchView = {
  status: "not_matched" | "matched" | "needs_variant" | "market_data_unavailable";
  productId: string | null;
  variantId: string | null;
  title: string | null;
  brand: string | null;
  model: string | null;
  style: string | null;
  colorway: string | null;
  color: string | null;
  size: string | null;
  image: string | null;
  category: string | null;
  url: string | null;
  matchSource: string | null;
  matchConfidence: number | null;
  marketDataCheckedAt: string | null;
};

export type ItemDetailView = ItemView & {
  sku: string | null;
  description: string;
  bulletPoints: string[];
  pricingRationale: string | null;
  measurements: Measurement[];
  flaws: Flaw[];
  /** Seller-saved eBay category override (marketplaceDrafts.ebay.categoryId). */
  ebayCategoryId: string | null;
  /** Seller-saved eBay quantity, defaulted to 1 for resale listings. */
  ebayQuantity: number;
  /** Seller-saved eBay item specifics (marketplaceDrafts.ebay.aspects). */
  ebayAspects: Record<string, string>;
  stockxMatch: StockXMatchView;
  selectedMarketplaces: string[];
  readiness: ReadinessView;
  attempts: AttemptView[];
  photos: { id: string; position: number; url: string | null }[];
};

export type ChannelView = {
  marketplace: string;
  name: string;
  capabilities: {
    draftPreview: boolean;
    publish: boolean;
    inventorySync: boolean;
    delist?: boolean;
  };
  listedCount: number;
};

export type KpiView = {
  label: string;
  value: string;
  sub: string;
  delta: "up" | "down" | null;
};
