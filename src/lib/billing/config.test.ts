import { describe, expect, it } from "vitest";

import { isBillingConfigured, loadStripeConfig } from "./config";

const full = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_KINGPIN: "price_king",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
};

describe("stripe config", () => {
  it("reports configured only when complete", () => {
    expect(isBillingConfigured(full)).toBe(true);
    expect(isBillingConfigured({ ...full, STRIPE_PRICE_KINGPIN: "" })).toBe(false);
    expect(isBillingConfigured({})).toBe(false);
  });

  it("treats bracket-masked vars as missing", () => {
    expect(isBillingConfigured({ ...full, STRIPE_SECRET_KEY: "[redacted]" })).toBe(false);
  });

  it("loads a typed config", () => {
    const cfg = loadStripeConfig(full);
    expect(cfg.secretKey).toBe("sk_test_123");
    expect(cfg.webhookSecret).toBe("whsec_123");
    expect(cfg.priceIds.pro).toBe("price_pro");
    expect(cfg.priceIds.kingpin).toBe("price_king");
    expect(cfg.publishableKey).toBe("pk_test_123");
  });

  it("treats an absent publishable key as null, not an error", () => {
    const noPk = { ...full, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined };
    expect(loadStripeConfig(noPk).publishableKey).toBeNull();
  });

  it("throws when a required var is absent", () => {
    expect(() => loadStripeConfig({})).toThrow();
    expect(() => loadStripeConfig({ ...full, STRIPE_WEBHOOK_SECRET: "" })).toThrow();
  });
});
