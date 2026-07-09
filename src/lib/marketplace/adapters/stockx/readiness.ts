export type StockXListingReadinessInput = {
  apiConfigured: boolean;
  listingEnabled: boolean;
  connected: boolean;
  productId: string | null | undefined;
  variantId: string | null | undefined;
  priceCents: number | null | undefined;
  quantityAvailable: number | null | undefined;
  confirmed: boolean;
};

export type StockXListingReadinessResult =
  | { ready: true; missing: [] }
  | { ready: false; missing: string[] };

export function evaluateStockXListingReadiness(
  input: StockXListingReadinessInput,
): StockXListingReadinessResult {
  const missing: string[] = [];

  if (!input.apiConfigured) missing.push("stockx_api");
  if (!input.listingEnabled) missing.push("stockx_listing_enabled");
  if (!input.connected) missing.push("stockx_connection");
  if (!hasText(input.productId)) missing.push("stockx_product_match");
  if (!hasText(input.variantId)) missing.push("stockx_variant_match");
  if (
    typeof input.priceCents !== "number" ||
    !Number.isFinite(input.priceCents) ||
    input.priceCents <= 0
  ) {
    missing.push("price");
  }
  if (
    typeof input.quantityAvailable !== "number" ||
    !Number.isFinite(input.quantityAvailable) ||
    input.quantityAvailable <= 0
  ) {
    missing.push("inventory_quantity");
  }
  if (!input.confirmed) missing.push("confirmation");

  return missing.length === 0 ? { ready: true, missing: [] } : { ready: false, missing };
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
