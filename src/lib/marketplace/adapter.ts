import type { Marketplace } from "@/lib/ai/listing-draft";

// Legacy compatibility adapters for the old publishDraft surface. Live
// integrations such as eBay, Etsy, TikTok Shop, and StockX use dedicated
// marketplace handlers instead of this generic adapter. The fallback adapter
// still returns an explicit, typed "not implemented" so nothing is silently
// dropped or faked as a success.

export type PublishNotImplemented = {
  status: "not_implemented";
  code: "NOT_IMPLEMENTED";
  marketplace: Marketplace;
  reason: string;
};

export type PublishOutcome = PublishNotImplemented;

export type MarketplaceCapabilities = {
  draftPreview: boolean;
  publish: boolean;
  inventorySync: boolean;
};

export type PublishInput = {
  inventoryItemId: string;
};

export interface MarketplaceAdapter {
  readonly marketplace: Marketplace;
  readonly displayName: string;
  readonly capabilities: MarketplaceCapabilities;
  publishDraft(input: PublishInput): Promise<PublishOutcome>;
}

function createStubAdapter(
  marketplace: Marketplace,
  displayName: string,
): MarketplaceAdapter {
  return {
    marketplace,
    displayName,
    capabilities: {
      draftPreview: true,
      publish: false,
      inventorySync: false,
    },
    async publishDraft(): Promise<PublishOutcome> {
      return {
        status: "not_implemented",
        code: "NOT_IMPLEMENTED",
        marketplace,
        reason: `${displayName} publishing is not implemented. Listings stay draft-only; no marketplace request is made.`,
      };
    },
  };
}

const ADAPTERS: Record<Marketplace, MarketplaceAdapter> = {
  ebay: createStubAdapter("ebay", "eBay"),
  grailed: createStubAdapter("grailed", "Grailed"),
  poshmark: createStubAdapter("poshmark", "Poshmark"),
  depop: createStubAdapter("depop", "Depop"),
  mercari: createStubAdapter("mercari", "Mercari"),
  etsy: createStubAdapter("etsy", "Etsy"),
  // These channels publish through dedicated handlers when available; the
  // generic publishDraft adapter remains NOT_IMPLEMENTED.
  tiktok_shop: createStubAdapter("tiktok_shop", "TikTok Shop"),
  vinted: createStubAdapter("vinted", "Vinted"),
  stockx: createStubAdapter("stockx", "StockX"),
};

export function getMarketplaceAdapter(
  marketplace: Marketplace,
): MarketplaceAdapter {
  return ADAPTERS[marketplace];
}

export function listMarketplaceAdapters(): MarketplaceAdapter[] {
  return Object.values(ADAPTERS);
}
