import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getStripe, resetStripeClientForTests } from "./stripe";

const env = {
  STRIPE_SECRET_KEY: "ci-placeholder-secret-key",
  STRIPE_WEBHOOK_SECRET: "ci-placeholder-webhook-secret",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_KINGPIN: "price_king",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "ci-placeholder-public-key",
};

afterEach(resetStripeClientForTests);

describe("Stripe client API compatibility", () => {
  it("keeps the deployed API version when the SDK default changes", () => {
    // Client construction is local; this test never calls a Stripe endpoint.
    expect(getStripe(env).getApiField("version")).toBe("2026-06-24.dahlia");
  });
});
