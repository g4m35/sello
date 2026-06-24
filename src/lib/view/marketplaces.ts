// Display metadata for marketplace logos (text mark). Mirrors the design's
// MpLogo registry. The app currently has adapters for ebay/grailed/poshmark/
// depop/etsy only; the rest are kept for label rendering robustness.
export const MP_LOGO: Record<string, { label: string; color: string }> = {
  ebay: { label: "eb", color: "#0064D2" },
  depop: { label: "DP", color: "#FF0000" },
  poshmark: { label: "PS", color: "#7B2D8E" },
  etsy: { label: "Et", color: "#F1641E" },
  mercari: { label: "M", color: "#FF6B35" },
  grailed: { label: "GR", color: "#0B0B0A" },
  stockx: { label: "SX", color: "#0B7C2B" },
  goat: { label: "GT", color: "#0B0B0A" },
  whatnot: { label: "WN", color: "#FF4742" },
  vinted: { label: "VT", color: "#09B1BA" },
  facebook: { label: "FB", color: "#1877F2" },
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
};

export function marketplaceName(id: string): string {
  return MARKETPLACE_NAME[id] ?? id;
}

export function mpLogo(id: string): { label: string; color: string } {
  return MP_LOGO[id] ?? { label: id.slice(0, 2).toUpperCase(), color: "#666" };
}

// Seller-facing capability label for a marketplace card. Marketplaces without a
// publish adapter are "Copy-ready draft" (build the listing here, copy the
// ready-to-paste text) — never CSV, which is not part of the normal seller flow.
export function marketplaceCapabilityLabel(input: {
  marketplace: string;
  publish: boolean;
}): string {
  if (input.marketplace === "ebay") {
    return input.publish ? "Live publishing" : "Preview + manual";
  }
  return "Copy-ready draft";
}
