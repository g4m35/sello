import { describe, expect, it } from "vitest";

import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";

import {
  ebayReadinessHelp,
  ebayReadinessLabels,
  getEbayActionModel,
  getEbayConnectionStatus,
  getEbaySalesPermissionLabel,
  getEbaySetupMessage,
  shouldAutoRefreshEbayReadiness,
  shouldOfferEbayLocationSetup,
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
  it("asks to reconnect a connected account with missing sales permission", () => {
    const data = readiness({ ready: true, missing: [], salesReadPermission: false });
    expect(getEbayConnectionStatus(data)).toBe("Connected");
    expect(getEbaySalesPermissionLabel(data)).toBe("Permission needed");
    expect(getEbayActionModel(data)).toMatchObject({ showPrimaryConnect: true, primaryConnectLabel: "Reconnect eBay" });
  });

  it("does not promise worker health when permission is present, or invent a missing permission", () => {
    expect(getEbaySalesPermissionLabel(readiness({ salesReadPermission: true }))).toBe("Granted");
    expect(getEbaySalesPermissionLabel(readiness())).toBe("Not verified");
    expect(getEbayActionModel(readiness({ salesReadPermission: true })).showPrimaryConnect).toBe(false);
    expect(getEbayActionModel(readiness({ salesReadPermission: null })).showPrimaryConnect).toBe(true);
    expect(getEbayConnectionStatus(null)).toBe("Checking connection…");
  });

  it("renders connected but incomplete production setup as finish-setup", () => {
    const model = getEbaySetupMessage(readiness());

    expect(model.heading).toBe("Finish eBay setup");
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

  it("does not show a primary Connect eBay action when connected with verified sales access", () => {
    const actions = getEbayActionModel(readiness({ salesReadPermission: true }));

    expect(actions.showPrimaryConnect).toBe(false);
    expect(actions.primaryConnectLabel).toBe("Connect eBay");
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
  });

  it("renders reconnect-required as an actionable reconnect message, not a generic failure", () => {
    const model = getEbaySetupMessage(
      readiness({
        connected: false,
        reconnectRequired: true,
        missing: ["oauth_connection"],
      }),
    );

    expect(model.heading).toBe("Reconnect eBay");
    expect(model.body).toContain("expired");
    expect(model.body.toLowerCase()).not.toContain("failed");
  });

  it("offers the primary connect action when reconnect is required", () => {
    const actions = getEbayActionModel(
      readiness({
        connected: false,
        reconnectRequired: true,
        missing: ["oauth_connection"],
      }),
    );

    expect(actions.showPrimaryConnect).toBe(true);
  });

  it("offers the location setup form only when the location is missing on a live connection", () => {
    expect(
      shouldOfferEbayLocationSetup(readiness({ missing: ["inventory_location"] })),
    ).toBe(true);
    expect(shouldOfferEbayLocationSetup(readiness({ missing: [] }))).toBe(false);
    expect(
      shouldOfferEbayLocationSetup(
        readiness({ connected: false, missing: ["oauth_connection"] }),
      ),
    ).toBe(false);
    expect(
      shouldOfferEbayLocationSetup(
        readiness({
          connected: false,
          reconnectRequired: true,
          missing: ["oauth_connection", "inventory_location"],
        }),
      ),
    ).toBe(false);
    expect(shouldOfferEbayLocationSetup(null)).toBe(false);
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
