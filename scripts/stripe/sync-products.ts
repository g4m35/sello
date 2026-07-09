/**
 * Idempotent Stripe product/price provisioner for Sello's paid plans.
 *
 * Run with a TEST secret key in the environment:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe/sync-products.ts
 *
 * For each paid plan it finds-or-creates a product (tagged with
 * metadata.sello_plan) and finds-or-creates an active monthly recurring price
 * at the catalog amount. It never deletes or duplicates: re-running is safe.
 * It prints the resulting price ids to copy into STRIPE_PRICE_PRO /
 * STRIPE_PRICE_KINGPIN. It does not print the secret key.
 */
import Stripe from "stripe";

import { PAID_PLAN_IDS, PLAN_CATALOG } from "../../src/lib/billing/plans";

const PLAN_TAG = "sello_plan";

function requireSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("[")) {
    throw new Error("STRIPE_SECRET_KEY is not set in the environment.");
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run: STRIPE_SECRET_KEY is not a test key (expected sk_test_...).",
    );
  }
  return key;
}

async function findProduct(stripe: Stripe, planId: string): Promise<Stripe.Product | null> {
  // Search is the cheapest exact lookup, but fall back to a list scan for
  // accounts where search is not enabled.
  try {
    const result = await stripe.products.search({
      query: `active:'true' AND metadata['${PLAN_TAG}']:'${planId}'`,
      limit: 1,
    });
    if (result.data[0]) return result.data[0];
  } catch {
    // ignore, fall through to list
  }
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.[PLAN_TAG] === planId) return product;
  }
  return null;
}

async function findMonthlyPrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
): Promise<Stripe.Price | null> {
  for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (
      price.recurring?.interval === "month" &&
      price.unit_amount === unitAmount &&
      price.currency === "usd"
    ) {
      return price;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const stripe = new Stripe(requireSecretKey(), { apiVersion: "2026-06-24.dahlia" });
  const out: Record<string, string> = {};

  for (const planId of PAID_PLAN_IDS) {
    const plan = PLAN_CATALOG[planId];

    let product = await findProduct(stripe, planId);
    if (!product) {
      product = await stripe.products.create({
        name: `Sello ${plan.name}`,
        metadata: { [PLAN_TAG]: planId },
      });
      console.log(`created product ${product.id} for ${planId}`);
    } else {
      console.log(`reusing product ${product.id} for ${planId}`);
    }

    let price = await findMonthlyPrice(stripe, product.id, plan.priceCents);
    if (!price) {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.priceCents,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { [PLAN_TAG]: planId },
      });
      console.log(`created price ${price.id} for ${planId}`);
    } else {
      console.log(`reusing price ${price.id} for ${planId}`);
    }

    out[planId] = price.id;
  }

  console.log("\nCopy these into your env (test mode):");
  console.log(`STRIPE_PRICE_PRO=${out.pro}`);
  console.log(`STRIPE_PRICE_KINGPIN=${out.kingpin}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
