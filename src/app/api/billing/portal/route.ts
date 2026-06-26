import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { assertCanManageAccount } from "@/lib/billing/membership";
import { getStripe } from "@/lib/billing/stripe";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Opens the Stripe-hosted Customer Portal so the user can upgrade, downgrade,
// cancel, or update their card. All of that lives in Stripe; the app holds no
// card data.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertCanManageAccount(account, user.id, prisma);

    const subscription = await prisma.subscription.findUnique({
      where: { accountId: account.id },
      select: { stripeCustomerId: true },
    });

    if (!subscription?.stripeCustomerId) {
      throw new AppError(
        "No billing account yet. Subscribe to a plan first.",
        409,
        "NO_BILLING_CUSTOMER",
      );
    }

    const origin = request.headers.get("origin") ?? new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${origin}/settings/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "billing_portal",
      fallbackCode: "PORTAL_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
