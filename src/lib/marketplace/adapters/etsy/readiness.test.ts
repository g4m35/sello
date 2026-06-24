import { describe, expect, it } from "vitest";

import { evaluateEtsyReadiness, type EtsyReadinessInput } from "./readiness";

const connectedReady: EtsyReadinessInput = {
  apiEnabled: true,
  connected: true,
  reconnectRequired: false,
  title: "Supreme Box Logo Hoodie Heather Grey",
  description: "Authentic bogo hoodie in great condition.",
  priceCents: 42000,
  quantity: 1,
  photoCount: 3,
  taxonomyId: 1234,
  shippingProfileId: 5678,
  returnPolicyId: 9012,
};

describe("evaluateEtsyReadiness", () => {
  it("reports api_enabled missing and keeps copy-ready when the API is off", () => {
    const result = evaluateEtsyReadiness({ ...connectedReady, apiEnabled: false });
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["api_enabled"]);
    expect(result.copyReadyAvailable).toBe(true);
  });

  it("reports connection missing when not connected", () => {
    const result = evaluateEtsyReadiness({ ...connectedReady, connected: false });
    expect(result.missing).toEqual(["connection"]);
    expect(result.copyReadyAvailable).toBe(true);
  });

  it("requires the Etsy-specific fields Sello cannot infer", () => {
    const result = evaluateEtsyReadiness({
      ...connectedReady,
      taxonomyId: null,
      shippingProfileId: null,
      returnPolicyId: null,
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("taxonomy");
    expect(result.missing).toContain("shipping_profile");
    expect(result.missing).toContain("return_policy");
  });

  it("requires shared listing fields", () => {
    const result = evaluateEtsyReadiness({
      ...connectedReady,
      title: "",
      priceCents: 0,
      photoCount: 0,
    });
    expect(result.missing).toEqual(
      expect.arrayContaining(["title", "price", "photos"]),
    );
  });

  it("is ready when connected with every field present", () => {
    const result = evaluateEtsyReadiness(connectedReady);
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
