import type { EtsyReadinessRequirement, EtsyReadinessResponse } from "./types";

// Etsy publish readiness. Pure and synchronous. It folds the shared listing
// fields (title/description/price/quantity/photos) together with the
// Etsy-specific fields Sello cannot infer (taxonomy/category, shipping profile,
// and — for physical US items — a return policy). Copy-ready export is always
// available regardless of this result, so a not-ready listing is never a dead end.
export type EtsyReadinessInput = {
  apiEnabled: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  title: string | null | undefined;
  description: string | null | undefined;
  priceCents: number | null | undefined;
  quantity: number | null | undefined;
  photoCount: number;
  // Seller-provided Etsy specifics (null/empty until the seller selects them).
  taxonomyId: number | string | null | undefined;
  shippingProfileId: number | string | null | undefined;
  returnPolicyId: number | string | null | undefined;
};

export function evaluateEtsyReadiness(
  input: EtsyReadinessInput,
): EtsyReadinessResponse {
  if (!input.apiEnabled) {
    return {
      apiEnabled: false,
      connected: false,
      reconnectRequired: false,
      ready: false,
      missing: ["api_enabled"],
      copyReadyAvailable: true,
    };
  }

  if (!input.connected || input.reconnectRequired) {
    return {
      apiEnabled: true,
      connected: input.connected && !input.reconnectRequired,
      reconnectRequired: input.reconnectRequired,
      ready: false,
      missing: ["connection"],
      copyReadyAvailable: true,
    };
  }

  const missing: EtsyReadinessRequirement[] = [];
  if (!input.title?.trim()) missing.push("title");
  if (!input.description?.trim()) missing.push("description");
  if (input.priceCents == null || input.priceCents <= 0) missing.push("price");
  if (input.quantity == null || input.quantity <= 0) missing.push("quantity");
  if (input.photoCount < 1) missing.push("photos");
  if (!present(input.taxonomyId)) missing.push("taxonomy");
  if (!present(input.shippingProfileId)) missing.push("shipping_profile");
  if (!present(input.returnPolicyId)) missing.push("return_policy");

  return {
    apiEnabled: true,
    connected: true,
    reconnectRequired: false,
    ready: missing.length === 0,
    missing,
    copyReadyAvailable: true,
  };
}

function present(value: number | string | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Number.isFinite(value) && value > 0;
}
