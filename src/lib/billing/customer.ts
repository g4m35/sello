import "server-only";

import type Stripe from "stripe";

import { getPrisma } from "@/lib/prisma";

import { getStripe } from "./stripe";

type Db = ReturnType<typeof getPrisma>;

// Find-or-create the Stripe customer for an account and persist its id on the
// account's Subscription row (the billing record). Idempotent: once a customer
// id is stored we reuse it, so repeat checkouts never spawn duplicate customers.
// The Subscription row starts as a free/active placeholder; the webhook fills in
// the real plan, status, and subscription id after checkout completes.
export async function ensureStripeCustomer(
  account: { id: string },
  email: string | null | undefined,
  prisma: Db = getPrisma(),
  stripe: Stripe = getStripe(),
): Promise<string> {
  const existing = await prisma.subscription.findUnique({
    where: { accountId: account.id },
  });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { accountId: account.id },
  });

  await prisma.subscription.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      stripeCustomerId: customer.id,
      plan: "free",
      status: "active",
    },
    update: { stripeCustomerId: customer.id },
  });

  return customer.id;
}
