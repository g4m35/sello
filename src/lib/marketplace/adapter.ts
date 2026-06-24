import type { Marketplace } from "@/lib/ai/listing-draft";

// Scaffolding only. No adapter performs real publishing, marketplace API
// calls, Playwright automation, or anti-bot circumvention. The single
// possible outcome is an explicit, typed "not implemented" so nothing is
// ever silently dropped or faked as a success.

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
  etsy: createStubAdapter("etsy", "Etsy"),
};

export function getMarketplaceAdapter(
  marketplace: Marketplace,
): MarketplaceAdapter {
  return ADAPTERS[marketplace];
}

export function listMarketplaceAdapters(): MarketplaceAdapter[] {
  return Object.values(ADAPTERS);
}
