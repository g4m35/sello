export type SoldCompProviderStatus =
  | "available"
  | "restricted"
  | "manual_only"
  | "future_provider";

export type SoldCompProviderOption = {
  id: string;
  label: string;
  status: SoldCompProviderStatus;
  note: string;
};

// Source audit snapshot, intentionally kept in code near the adapter registry:
// - eBay Browse returns active purchasable listings, not completed sales.
// - eBay Marketplace Insights is the official sold-history API, but restricted
//   / limited-release and should only be enabled after approved access.
// - Manual sold URLs/imports are the safe current sold-comp path.
// - Future providers need official/API access or explicit compliant data terms.
export const SOLD_COMP_PROVIDER_OPTIONS: SoldCompProviderOption[] = [
  {
    id: "ebay-marketplace-insights",
    label: "eBay Marketplace Insights",
    status: "restricted",
    note:
      "Official eBay sold-history API; keep disabled until Marketplace Insights access is approved.",
  },
  {
    id: "manual-sold-comp",
    label: "Manual sold comp",
    status: "manual_only",
    note:
      "Seller-provided sold/completed URLs and prices are the current safe sold-comp path.",
  },
  {
    id: "future-provider-api",
    label: "Future provider API",
    status: "future_provider",
    note:
      "Add only providers with API/contract access; do not bypass login, bot checks, or paywalls.",
  },
];
