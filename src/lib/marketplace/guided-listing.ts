import type { Marketplace } from "@/lib/ai/listing-draft";

// Guided (assisted) listing metadata for channels the seller lists on manually.
// sellFormUrl opens the marketplace's own listing form in the seller's session;
// listingUrlHosts validates the URL the seller pastes back after listing.
export type GuidedListingMeta = {
  sellFormUrl: string;
  listingUrlHosts: string[];
};

export const GUIDED_LISTING: Partial<Record<Marketplace, GuidedListingMeta>> = {
  grailed: {
    sellFormUrl: "https://www.grailed.com/sell/new",
    listingUrlHosts: ["grailed.com", "www.grailed.com"],
  },
  poshmark: {
    sellFormUrl: "https://poshmark.com/create-listing",
    listingUrlHosts: ["poshmark.com", "www.poshmark.com"],
  },
  depop: {
    sellFormUrl: "https://www.depop.com/products/create",
    listingUrlHosts: ["depop.com", "www.depop.com"],
  },
  vinted: {
    sellFormUrl: "https://www.vinted.com/items/new",
    listingUrlHosts: ["vinted.com", "www.vinted.com"],
  },
  mercari: {
    sellFormUrl: "https://www.mercari.com/sell/",
    listingUrlHosts: ["mercari.com", "www.mercari.com"],
  },
  // Etsy has a native gated adapter, but it is also a copy-ready export channel;
  // when a seller lists on Etsy manually, the guided panel still lets them mark
  // it as listed so the double-sell engine covers it.
  etsy: {
    sellFormUrl: "https://www.etsy.com/your/shops/me/tools/listings/create",
    listingUrlHosts: ["etsy.com", "www.etsy.com"],
  },
};

export function guidedListingMeta(
  marketplace: Marketplace,
): GuidedListingMeta | null {
  return GUIDED_LISTING[marketplace] ?? null;
}

// URL parses, is https, and the host equals a listed host or is a subdomain of
// one. Advisory client-side check only; the server route stays authoritative.
export function isPlausibleListingUrl(
  marketplace: Marketplace,
  url: string,
): boolean {
  const meta = guidedListingMeta(marketplace);
  if (!meta) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;

    return meta.listingUrlHosts.some(
      (allowedHost) =>
        parsed.hostname === allowedHost ||
        parsed.hostname.endsWith(`.${allowedHost}`),
    );
  } catch {
    return false;
  }
}
