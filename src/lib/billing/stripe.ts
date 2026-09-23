import "server-only";

import Stripe from "stripe";

import { loadStripeConfig } from "./config";

let client: Stripe | null = null;

// Memoized server-only Stripe client. apiVersion is pinned to the version this
// application was validated against so its wire behavior stays stable across SDK
// upgrades. The SDK types track a newer API; no new fields are assumed here.
// The secret key is read from config and never logged.
export function getStripe(env: Record<string, string | undefined> = process.env): Stripe {
  if (client) return client;
  const { secretKey } = loadStripeConfig(env);
  client = new Stripe(secretKey, {
    // Keep the deployed API contract; newer SDK types describe only their latest API.
    // @ts-expect-error Stripe supports older API versions at runtime.
    apiVersion: "2026-06-24.dahlia",
  });
  return client;
}

// Test-only escape hatch so unit tests can reset the memoized client between
// runs with different fake keys.
export function resetStripeClientForTests(): void {
  client = null;
}
