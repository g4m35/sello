import type { Marketplace } from "@/lib/ai/listing-draft";

// The marketplace registry describes, for every channel, the *highest real
// autonomy level currently possible* plus the capability ceiling it can reach
// once fully connected/eligible. It is additive: the existing publish flow is
// driven by the minimal MarketplaceAdapter capabilities + publishImplementedFor,
// not by this registry. New marketplace cards/readiness consume this model so
// the UI can honestly show "full API", "API gated", "catalog match", or
// "assisted" without branching on hardcoded marketplace ids.

export type MarketplaceIntegrationMode =
  | "full_native"
  | "gated_scaffold"
  | "catalog_match_scaffold"
  | "assisted";

// The operational state a marketplace shows before the seller has connected or
// configured it. Drives the marketplace card's default badge/copy.
export type MarketplaceDefaultStatus =
  | "live"
  | "access_required"
  | "catalog_match_required"
  | "shop_connection_required"
  | "assisted_export"
  | "copy_ready";

export type MarketplaceFallbackMode = "assisted_export" | "copy_ready" | null;

// Capability ceiling. The `can*` flags are what the integration can do once
// fully live; resolveCurrentCapabilities() gates them down to the real, current
// state (fail-closed). The `requires*` flags describe what a seller must satisfy
// and are always true regardless of connection state.
export type MarketplaceCapabilityMatrix = {
  canAutoPublish: boolean;
  canCreateDraft: boolean;
  canUpdateListing: boolean;
  canDeleteListing: boolean;
  canSyncInventory: boolean;
  canReceiveSoldWebhook: boolean;
  requiresBusinessAccount: boolean;
  requiresManualApproval: boolean;
  requiresShopConnection: boolean;
  requiresCatalogMatch: boolean;
  requiresRequiredProductFields: boolean;
  mayRequirePlatformAudit: boolean;
};

export type MarketplaceDescriptor = {
  key: Marketplace;
  displayName: string;
  integrationMode: MarketplaceIntegrationMode;
  // Human-readable description of the best future autonomy mode for this channel.
  bestFutureMode: string;
  defaultStatus: MarketplaceDefaultStatus;
  fallbackMode: MarketplaceFallbackMode;
  capabilities: MarketplaceCapabilityMatrix;
  uiCopy: string;
};

// Live state used to gate the capability ceiling down to what is actually
// possible right now. Every missing/false input keeps the result fail-closed.
export type MarketplaceLiveState = {
  enabled: boolean;
  connected: boolean;
  // True only when a real adapter performs live marketplace API calls. Gated
  // scaffolds (Vinted/StockX) pass false, so their can* flags never light up.
  implemented: boolean;
  shopConnected?: boolean;
  catalogMatched?: boolean;
};

const CAPABILITY_KEYS = [
  "canAutoPublish",
  "canCreateDraft",
  "canUpdateListing",
  "canDeleteListing",
  "canSyncInventory",
  "canReceiveSoldWebhook",
] as const satisfies readonly (keyof MarketplaceCapabilityMatrix)[];

function matrix(
  partial: Partial<MarketplaceCapabilityMatrix>,
): MarketplaceCapabilityMatrix {
  return {
    canAutoPublish: false,
    canCreateDraft: false,
    canUpdateListing: false,
    canDeleteListing: false,
    canSyncInventory: false,
    canReceiveSoldWebhook: false,
    requiresBusinessAccount: false,
    requiresManualApproval: false,
    requiresShopConnection: false,
    requiresCatalogMatch: false,
    requiresRequiredProductFields: false,
    mayRequirePlatformAudit: false,
    ...partial,
  };
}

export const MARKETPLACE_REGISTRY: Record<Marketplace, MarketplaceDescriptor> = {
  ebay: {
    key: "ebay",
    displayName: "eBay",
    integrationMode: "full_native",
    bestFutureMode: "eBay Sell API (full native publishing)",
    defaultStatus: "live",
    fallbackMode: null,
    capabilities: matrix({
      canAutoPublish: true,
      canCreateDraft: true,
      canDeleteListing: true,
      requiresManualApproval: true,
    }),
    uiCopy:
      "eBay live publishing is available to selected accounts via the eBay Sell API.",
  },
  etsy: {
    key: "etsy",
    displayName: "Etsy",
    integrationMode: "full_native",
    bestFutureMode: "Etsy Open API v3",
    defaultStatus: "access_required",
    fallbackMode: "copy_ready",
    capabilities: matrix({
      canAutoPublish: true,
      canCreateDraft: true,
      canDeleteListing: true,
      canSyncInventory: true,
      requiresManualApproval: true,
    }),
    uiCopy:
      "Etsy live publishing is gated to selected accounts; copy-ready drafts are always available.",
  },
  grailed: {
    key: "grailed",
    displayName: "Grailed",
    integrationMode: "assisted",
    bestFutureMode: "Assisted export (no official listing API)",
    defaultStatus: "copy_ready",
    fallbackMode: "copy_ready",
    capabilities: matrix({ canCreateDraft: true }),
    uiCopy: "Grailed uses copy-ready drafts; no official listing API exists.",
  },
  poshmark: {
    key: "poshmark",
    displayName: "Poshmark",
    integrationMode: "assisted",
    bestFutureMode: "Assisted export (no official listing API)",
    defaultStatus: "copy_ready",
    fallbackMode: "copy_ready",
    capabilities: matrix({ canCreateDraft: true }),
    uiCopy: "Poshmark uses copy-ready drafts; no official listing API exists.",
  },
  depop: {
    key: "depop",
    displayName: "Depop",
    integrationMode: "assisted",
    bestFutureMode: "Assisted export (no official listing API)",
    defaultStatus: "copy_ready",
    fallbackMode: "copy_ready",
    capabilities: matrix({ canCreateDraft: true }),
    uiCopy: "Depop uses copy-ready drafts; no official listing API exists.",
  },
  vinted: {
    key: "vinted",
    displayName: "Vinted",
    integrationMode: "gated_scaffold",
    bestFutureMode: "Vinted Pro API",
    defaultStatus: "access_required",
    fallbackMode: "assisted_export",
    capabilities: matrix({
      canAutoPublish: true,
      canUpdateListing: true,
      canDeleteListing: true,
      canSyncInventory: true,
      canReceiveSoldWebhook: true,
      requiresBusinessAccount: true,
      requiresManualApproval: true,
    }),
    uiCopy:
      "Vinted Pro API access required. Sello can support autonomous listing, updates, inventory sync, and sold-item sync after Vinted Pro Integrations access is approved.",
  },
  stockx: {
    key: "stockx",
    displayName: "StockX",
    integrationMode: "catalog_match_scaffold",
    bestFutureMode: "Catalog-matched market data and future gated listing automation",
    defaultStatus: "catalog_match_required",
    fallbackMode: "assisted_export",
    capabilities: matrix({
      canCreateDraft: true,
      canReceiveSoldWebhook: false,
      requiresCatalogMatch: true,
      requiresManualApproval: true,
    }),
    uiCopy:
      "StockX requires an exact catalog match. Sello can save StockX product matches and use gated market data; live StockX listing creation is disabled.",
  },
  tiktok_shop: {
    key: "tiktok_shop",
    displayName: "TikTok Shop",
    integrationMode: "full_native",
    bestFutureMode: "TikTok Shop Partner API (full native)",
    defaultStatus: "shop_connection_required",
    fallbackMode: null,
    capabilities: matrix({
      canAutoPublish: true,
      canCreateDraft: true,
      canUpdateListing: true,
      canDeleteListing: true,
      canSyncInventory: true,
      canReceiveSoldWebhook: true,
      requiresBusinessAccount: true,
      requiresManualApproval: true,
      requiresShopConnection: true,
      requiresRequiredProductFields: true,
      mayRequirePlatformAudit: true,
    }),
    uiCopy:
      "TikTok Shop requires a connected seller shop and required product/shipping fields. Sello can create, update, price, inventory-sync, and order-sync TikTok Shop products. Products may require TikTok audit before going live.",
  },
};

export function getMarketplaceDescriptor(
  marketplace: Marketplace,
): MarketplaceDescriptor {
  return MARKETPLACE_REGISTRY[marketplace];
}

// Integration modes that have NO live publish path and must fail closed at the
// enqueue boundary: a gated scaffold (Vinted) and a catalog-match scaffold
// (StockX) carry capability ceilings but no real adapter, so they must never be
// accepted into the autonomous publish queue. Assisted/copy-ready channels and
// full-native channels stay eligible (the worker still returns a typed
// NOT_IMPLEMENTED outcome until a real adapter lands), preserving existing
// behavior for eBay/Etsy/Grailed/Poshmark/Depop.
const NON_PUBLISHABLE_INTEGRATION_MODES: ReadonlySet<MarketplaceIntegrationMode> =
  new Set(["gated_scaffold", "catalog_match_scaffold"]);

// True only for channels that may be enqueued for autonomous publishing. Drives
// the publish-queue payload validation so gated/catalog scaffolds fail closed
// before the worker ever sees them.
export function isPublishQueueEligible(marketplace: Marketplace): boolean {
  return !NON_PUBLISHABLE_INTEGRATION_MODES.has(
    MARKETPLACE_REGISTRY[marketplace].integrationMode,
  );
}

export function listPublishQueueEligibleMarketplaces(): Marketplace[] {
  return listMarketplaceDescriptors()
    .filter((d) => isPublishQueueEligible(d.key))
    .map((d) => d.key);
}

export function listMarketplaceDescriptors(): MarketplaceDescriptor[] {
  return Object.values(MARKETPLACE_REGISTRY);
}

// Gate the capability ceiling down to the real current state. Fail-closed: any
// requirement that is not satisfied (disabled, not connected, no live adapter,
// missing shop connection, missing catalog match) zeroes the `can*` flags. The
// `requires*` descriptors are always preserved.
export function resolveCurrentCapabilities(
  descriptor: MarketplaceDescriptor,
  state: MarketplaceLiveState,
): MarketplaceCapabilityMatrix {
  const baseLive =
    state.enabled === true &&
    state.implemented === true &&
    state.connected === true;

  const shopOk =
    !descriptor.capabilities.requiresShopConnection ||
    state.shopConnected === true;

  const catalogOk =
    !descriptor.capabilities.requiresCatalogMatch ||
    state.catalogMatched === true;

  const live = baseLive && shopOk && catalogOk;

  const resolved: MarketplaceCapabilityMatrix = { ...descriptor.capabilities };
  if (!live) {
    for (const key of CAPABILITY_KEYS) {
      resolved[key] = false;
    }
  }
  return resolved;
}
