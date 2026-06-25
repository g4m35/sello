import "server-only";

import Stripe from "stripe";

import { loadStripeConfig } from "./config";

let client: Stripe | null = null;

// Memoized server-only Stripe client. apiVersion is pinned to the version this
// SDK was generated against so request/response shapes stay stable across SDK
// upgrades. The secret key is read from config and never logged.
export function getStripe(env: Record<string, string | undefined> = process.env): Stripe {
  if (client) return client;
  const { secretKey } = loadStripeConfig(env);
  client = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });
  return client;
}

// Test-only escape hatch so unit tests can reset the memoized client between
// runs with different fake keys.
export function resetStripeClientForTests(): void {
  client = null;
}
