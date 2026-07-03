import { StockXIntegrationError, stockxErrorCodes } from "./errors";

export type StockXCreateListingPayload = {
  amount: string;
  variantId: string;
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
    amount: (input.priceCents / 100).toFixed(2),
    variantId,
  };
}
