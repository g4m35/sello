// Display metadata for marketplace logos (text mark). Mirrors the design's
// MpLogo registry and includes channels that use dedicated marketplace handlers.
export const MP_LOGO: Record<string, { label: string; color: string }> = {
  ebay: { label: "eB", color: "#0B0B0A" },
  depop: { label: "De", color: "#0B0B0A" },
  poshmark: { label: "Po", color: "#0B0B0A" },
  etsy: { label: "Et", color: "#0B0B0A" },
  mercari: { label: "Me", color: "#0B0B0A" },
  grailed: { label: "Gr", color: "#0B0B0A" },
  stockx: { label: "Sx", color: "#0B0B0A" },
  goat: { label: "Go", color: "#0B0B0A" },
  whatnot: { label: "Wh", color: "#0B0B0A" },
  vinted: { label: "Vi", color: "#0B0B0A" },
  facebook: { label: "Fb", color: "#0B0B0A" },
  tiktok_shop: { label: "TT", color: "#0B0B0A" },
};

export const MARKETPLACE_NAME: Record<string, string> = {
  ebay: "eBay",
  grailed: "Grailed",
  poshmark: "Poshmark",
  depop: "Depop",
  etsy: "Etsy",
  mercari: "Mercari",
  stockx: "StockX",
  goat: "GOAT",
  whatnot: "Whatnot",
  vinted: "Vinted",
  facebook: "Facebook",
  tiktok_shop: "TikTok Shop",
};

export function marketplaceName(id: string): string {
  return MARKETPLACE_NAME[id] ?? id;
}

export function mpLogo(id: string): { label: string; color: string } {
  return MP_LOGO[id] ?? { label: id.slice(0, 2).toUpperCase(), color: "#0B0B0A" };
}

// Seller-facing capability label for compact selection surfaces.
export function marketplaceCapabilityLabel(input: {
  marketplace: string;
  publish: boolean;
}): string {
  if (input.marketplace === "ebay") {
    return input.publish ? "Live" : "Drafts";
  }
  if (input.marketplace === "tiktok_shop") {
    return input.publish ? "Live" : "Connect";
  }
  if (input.marketplace === "vinted") {
    return "API access";
  }
  if (input.marketplace === "stockx") {
    return "Catalog match";
  }
  return "Drafts";
}
