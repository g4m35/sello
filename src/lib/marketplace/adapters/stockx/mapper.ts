import { StockXIntegrationError, stockxErrorCodes } from "./errors";

export type StockXCreateListingPayload = {
  amount: string;
  variantId: string;
  currencyCode: "USD";
  active: true;
  inventoryType: "STANDARD";
};

export function buildStockXCreateListingPayload(input: {
  variantId: string | null | undefined;
  priceCents: number | null | undefined;
}): StockXCreateListingPayload {
  const variantId = input.variantId?.trim();
  if (!variantId) {
    throw new StockXIntegrationError(
      stockxErrorCodes.listingReadinessFailed,
      "Choose an exact StockX size/variant before listing.",
      422,
      { missing: ["stockx_variant_match"] },
    );
  }

  if (
    typeof input.priceCents !== "number" ||
    !Number.isFinite(input.priceCents) ||
    input.priceCents <= 0
  ) {
    throw new StockXIntegrationError(
      stockxErrorCodes.listingReadinessFailed,
      "Set a listing price before listing on StockX.",
      422,
      { missing: ["price"] },
    );
  }

  return {
    amount: formatStockXAmount(input.priceCents),
    variantId,
    currencyCode: "USD",
    active: true,
    inventoryType: "STANDARD",
  };
}

function formatStockXAmount(priceCents: number): string {
  const dollars = priceCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}
