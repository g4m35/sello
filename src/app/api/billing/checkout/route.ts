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
    const config = loadStripeConfig();
    const customerId = await ensureStripeCustomer(account, user.email, prisma);
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: config.priceIds[plan], quantity: 1 }],
      client_reference_id: account.id,
      success_url: `${origin}/settings/billing?status=success`,
      cancel_url: `${origin}/pricing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "billing_checkout",
      fallbackCode: "CHECKOUT_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
