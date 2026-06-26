import { NextResponse } from "next/server";

import { loadStripeConfig } from "@/lib/billing/config";
import { getStripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";
import { safeErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

// Stripe webhook receiver. The raw request body is required for signature
// verification, so we read request.text() and never parse or log it. An invalid
// or missing signature is rejected before any handler runs.
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const { webhookSecret } = loadStripeConfig();

  let event;
  try {
    if (!signature) throw new Error("missing stripe-signature header");
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Invalid webhook signature." } },
      { status: 400 },
    );
  }

  try {
    await handleStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    const { status, body: errorBody } = safeErrorResponse(error, {
      label: "billing_webhook",
      fallbackCode: "WEBHOOK_FAILED",
    });
    return NextResponse.json(errorBody, { status });
  }
}
