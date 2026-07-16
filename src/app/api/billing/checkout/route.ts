import { createHash } from "node:crypto";

import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { loadStripeConfig } from "@/lib/billing/config";
import { ensureStripeCustomer } from "@/lib/billing/customer";
import { assertCanManageAccount } from "@/lib/billing/membership";
import { getStripe } from "@/lib/billing/stripe";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({ plan: z.enum(["free", "pro", "kingpin"]) });

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

function isLiveSubscription(status: string): boolean {
  return !TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

function checkoutIdempotencyKey(
  accountId: string,
  requestedPriceId: string,
  latestSubscription: Stripe.Subscription | null,
): string {
  // The requested price must be part of the key: Stripe rejects a reused key
  // with different params, so an abandoned "upgrade to pro" attempt would
  // otherwise brick "upgrade to kingpin" for the key's ~24h lifetime.
  const state = latestSubscription
    ? `${latestSubscription.id}:${latestSubscription.status}:${latestSubscription.created}:${requestedPriceId}`
    : `no-subscription:${requestedPriceId}`;
  const generation = createHash("sha256").update(state).digest("hex").slice(0, 32);
  return `sello:billing:checkout:${accountId}:${generation}`;
}

async function listSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<{ live: Stripe.Subscription | null; latest: Stripe.Subscription | null }> {
  let startingAfter: string | undefined;

  do {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const live = page.data.find((subscription) => isLiveSubscription(subscription.status));
    if (live) return { live, latest: live };

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data.at(-1)?.id;
  } while (startingAfter);

  const latestPage = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 1,
  });
  return { live: null, latest: latestPage.data[0] ?? null };
}

function activeSubscriptionError(): AppError {
  return new AppError(
    "This account already has a Stripe subscription. Use Billing Portal to manage it.",
    409,
    "ACTIVE_SUBSCRIPTION_EXISTS",
  );
}

// Starts a Stripe-hosted subscription checkout for the authed user's account.
// No card data touches the app. The session carries client_reference_id = the
// account id so the webhook can attribute the resulting subscription.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { plan } = Body.parse(await request.json());

    if (plan === "free") {
      throw new AppError(
        "The free plan does not require checkout.",
        400,
        "FREE_PLAN_NOT_CHECKOUT",
      );
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertCanManageAccount(account, user.id, prisma);
    const billingRecord = await prisma.subscription.findUnique({
      where: { accountId: account.id },
      select: { stripeSubscriptionId: true, status: true },
    });
    if (
      billingRecord?.stripeSubscriptionId &&
      isLiveSubscription(billingRecord.status)
    ) {
      throw activeSubscriptionError();
    }

    const config = loadStripeConfig();
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(account, user.email, prisma, stripe);
    const subscriptions = await listSubscriptions(stripe, customerId);
    if (subscriptions.live) throw activeSubscriptionError();

    const origin = request.headers.get("origin") ?? new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: config.priceIds[plan], quantity: 1 }],
        client_reference_id: account.id,
        subscription_data: { metadata: { accountId: account.id } },
        success_url: `${origin}/settings/billing?status=success`,
        cancel_url: `${origin}/settings/billing?status=cancelled`,
      },
      {
        idempotencyKey: checkoutIdempotencyKey(
          account.id,
          config.priceIds[plan],
          subscriptions.latest,
        ),
      },
    );

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "billing_checkout",
      fallbackCode: "CHECKOUT_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
