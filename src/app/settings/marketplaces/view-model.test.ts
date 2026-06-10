import { describe, expect, it } from "vitest";

import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";

import {
  ebayReadinessHelp,
  ebayReadinessLabels,
  getEbayActionModel,
  getEbaySetupMessage,
  shouldAutoRefreshEbayReadiness,
} from "./view-model";

function readiness(
  overrides: Partial<EbayReadinessResponse> = {},
): EbayReadinessResponse {
  return {
    marketplace: "ebay",
    environment: "production",
    connected: true,
    ready: false,
    missing: [
      "payment_policy",
      "fulfillment_policy",
      "return_policy",
      "inventory_location",
    ],
    config: {
      marketplaceId: "EBAY_US",
      hasPaymentPolicy: false,
      hasFulfillmentPolicy: false,
      hasReturnPolicy: false,
      hasInventoryLocation: false,
    },
    ...overrides,
  };
}

describe("eBay marketplace settings view model", () => {
  it("renders connected but incomplete production setup as setup-required", () => {
    const model = getEbaySetupMessage(readiness());

    expect(model.heading).toBe("Setup required before publishing");
    expect(model.body).toContain("Connected");
    expect(model.body).toContain("business policies");
    expect(model.body).toContain("inventory location");
  });

  it("explains each missing policy and inventory location in plain language", () => {
    expect(ebayReadinessLabels.payment_policy).toBe("Payment policy");
    expect(ebayReadinessHelp.payment_policy).toContain("buyer payment");
    expect(ebayReadinessHelp.fulfillment_policy).toContain("shipping");
    expect(ebayReadinessHelp.return_policy).toContain("returns");
    expect(ebayReadinessHelp.inventory_location).toContain("ships from");
  });

  it("does not show a primary Connect eBay action after the account is connected", () => {
    const actions = getEbayActionModel(readiness());

    expect(actions.showPrimaryConnect).toBe(false);
    expect(actions.showSecondaryReconnect).toBe(true);
    expect(actions.primaryConnectLabel).toBe("Connect eBay");
    expect(actions.secondaryReconnectLabel).toBe("Reconnect eBay");
  });

  it("keeps the primary Connect action for disconnected accounts", () => {
    const actions = getEbayActionModel(
      readiness({
        connected: false,
        missing: ["oauth_connection"],
        checkedAt: undefined,
      }),
    );

    expect(actions.showPrimaryConnect).toBe(true);
    expect(actions.showSecondaryReconnect).toBe(false);
  });

  it("auto-refreshes once after OAuth when no live readiness check has run", () => {
    expect(shouldAutoRefreshEbayReadiness(readiness(), false)).toBe(true);
    expect(shouldAutoRefreshEbayReadiness(readiness(), true)).toBe(false);
    expect(
      shouldAutoRefreshEbayReadiness(
        readiness({ checkedAt: "2026-06-10T16:00:00.000Z" }),
        false,
      ),
    ).toBe(false);
  });
});
