import type { EbayEnvironment } from "@/lib/marketplace/adapters/ebay/types";

// Environment-aware wording for the eBay settings page. Sandbox wording must
// only ever appear when the backend reports the sandbox environment; while the
// environment is unknown (readiness not loaded yet) the labels stay neutral.
export function ebayMarketplaceLabels(environment: EbayEnvironment | null) {
  if (environment === "sandbox") {
    return {
      heading: "eBay Sandbox",
      account: "Sandbox account",
      connect: "Connect eBay Sandbox",
    };
  }

  return {
    heading: "eBay",
    account: environment === "production" ? "Production account" : "eBay account",
    connect: "Connect eBay",
  };
}
