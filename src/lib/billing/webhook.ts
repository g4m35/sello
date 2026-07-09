import "server-only";

import type Stripe from "stripe";

import { getPrisma } from "@/lib/prisma";

import { planForPriceId, type PlanId } from "./plans";

type Db = ReturnType<typeof getPrisma>;
type Env = Record<string, string | undefined>;

type StatusEnum =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

const STATUS_MAP: Record<string, StatusEnum> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "incomplete_expired",
  unpaid: "unpaid",
};

// Map a Stripe subscription status to our enum. Unknown/transitional states
// (e.g. "paused") map to past_due so the account is not treated as fully active.
function toStatus(stripeStatus: string): StatusEnum {
  return STATUS_MAP[stripeStatus] ?? "past_due";
}

function customerIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function firstItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  return sub.items?.data?.[0];
}

function periodOf(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const item = firstItem(sub);
  return {
    start: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
    end: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
  };
}

// Apply a subscription.created/updated/deleted event. plan is derived from the
// item's price id; terminal states fall back to free. Matched to our billing
// record by stripe customer id (created at checkout); unmatched customers are
// skipped rather than guessed at.
async function applySubscription(
  sub: Stripe.Subscription,
  prisma: Db,
  env: Env,
): Promise<void> {
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return;

  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!existing) return;

  const priceId = firstItem(sub)?.price?.id ?? "";
  const resolved = planForPriceId(priceId, env);
  const terminal = sub.status === "canceled" || sub.status === "incomplete_expired";
  const plan: PlanId = terminal ? "free" : (resolved ?? "free");
  const { start, end } = periodOf(sub);

  await prisma.subscription.update({
    where: { stripeCustomerId: customerId },
    data: {
      stripeSubscriptionId: sub.id,
      plan,
      status: toStatus(sub.status),
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    },
  });
  await prisma.account.update({ where: { id: existing.accountId }, data: { plan } });
}

// Bind the resulting subscription id to the account's billing record. The plan
// itself is set by the accompanying subscription.created event, so this handler
// only links ids (idempotent).
async function applyCheckoutCompleted(
  session: Stripe.Checkout.Session,
  prisma: Db,
): Promise<void> {
  const accountId = session.client_reference_id;
  if (!accountId) return;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  const customerId = customerIdOf(session.customer);

  await prisma.subscription.updateMany({
    where: { accountId },
    data: {
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
  });
}

async function applyPaymentFailed(invoice: Stripe.Invoice, prisma: Db): Promise<void> {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: { status: "past_due" },
  });
}

async function applyEvent(event: Stripe.Event, prisma: Db, env: Env): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await applyCheckoutCompleted(event.data.object as Stripe.Checkout.Session, prisma);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription, prisma, env);
      return;
    case "invoice.payment_failed":
      await applyPaymentFailed(event.data.object as Stripe.Invoice, prisma);
      return;
    default:
      // Unhandled types are still recorded as processed (no-op).
      return;
  }
}

// Idempotent entry point. A duplicate delivery short-circuits via the
// StripeEvent ledger. The underlying writes are upsert/update-by-key, so even a
// concurrent duplicate that races past the ledger check is harmless.
export async function handleStripeEvent(
  event: Stripe.Event,
  prisma: Db = getPrisma(),
  env: Env = process.env,
): Promise<void> {
  const already = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (already) return;

  await applyEvent(event, prisma, env);

  await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
}
