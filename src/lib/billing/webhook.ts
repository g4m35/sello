import "server-only";

import type Stripe from "stripe";

import { getPrisma } from "@/lib/prisma";

import { planForPriceId, type PlanId } from "./plans";
import { getStripe } from "./stripe";

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

function isTerminalStatus(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

async function withBillingLock<T>(
  prisma: Db,
  key: string,
  callback: (transaction: Db) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      key,
    );
    return callback(transaction as unknown as Db);
  });
}

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
  eventSubscription: Stripe.Subscription,
  prisma: Db,
  env: Env,
  stripe: Stripe,
): Promise<void> {
  const customerId = customerIdOf(eventSubscription.customer);
  if (!customerId) return;

  const billingRecord = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { accountId: true },
  });
  if (!billingRecord) return;

  await withBillingLock(prisma, `account:${billingRecord.accountId}`, async (transaction) => {
    // Events can arrive out of order. Re-read the object from Stripe INSIDE
    // the billing lock: a retrieve taken before the lock can go stale while
    // waiting on it, letting an old active snapshot overwrite a cancellation
    // that a concurrent handler already applied.
    const sub = await stripe.subscriptions.retrieve(eventSubscription.id);
    if (customerIdOf(sub.customer) !== customerId) return;

    const priceId = firstItem(sub)?.price?.id ?? "";
    const resolved = planForPriceId(priceId, env);
    const terminal = isTerminalStatus(sub.status);
    const plan: PlanId = terminal ? "free" : (resolved ?? "free");
    const { start, end } = periodOf(sub);

    const existing = await transaction.subscription.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (!existing) return;

    // Once a subscription has been bound, events for a different subscription
    // on the same customer are noncanonical and cannot change local access.
    if (existing.stripeSubscriptionId && existing.stripeSubscriptionId !== sub.id) return;

    await transaction.subscription.update({
      where: { stripeCustomerId: customerId },
      data: {
        stripeSubscriptionId: sub.id,
        plan,
        status: toStatus(sub.status),
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        // Leaving past_due keeps a stale grace deadline behind otherwise.
        ...(toStatus(sub.status) !== "past_due" ? { graceEndsAt: null } : {}),
      },
    });
    await transaction.account.update({ where: { id: existing.accountId }, data: { plan } });
  });
}

// Bind the resulting subscription id to the account's billing record. The plan
// and status are reconciled from Stripe here too because Checkout and
// subscription events are not guaranteed to arrive in a particular order.
async function applyCheckoutCompleted(
  session: Stripe.Checkout.Session,
  prisma: Db,
  env: Env,
  stripe: Stripe,
): Promise<void> {
  const accountId = session.client_reference_id;
  if (!accountId) return;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  const customerId = customerIdOf(session.customer);
  if (!subscriptionId || !customerId) return;

  await withBillingLock(prisma, `account:${accountId}`, async (transaction) => {
    // Retrieve inside the lock; see applySubscription for the staleness rationale.
    const candidate = await stripe.subscriptions.retrieve(subscriptionId);
    if (customerIdOf(candidate.customer) !== customerId || isTerminalStatus(candidate.status)) {
      return;
    }
    const priceId = firstItem(candidate)?.price?.id ?? "";
    const plan = planForPriceId(priceId, env) ?? "free";
    const { start, end } = periodOf(candidate);

    const existing = await transaction.subscription.findUnique({ where: { accountId } });
    if (!existing || existing.stripeCustomerId !== customerId) return;

    if (
      existing.stripeSubscriptionId &&
      existing.stripeSubscriptionId !== subscriptionId &&
      !isTerminalStatus(existing.status)
    ) {
      return;
    }

    await transaction.subscription.update({
      where: { accountId },
      data: {
        stripeSubscriptionId: subscriptionId,
        plan,
        status: toStatus(candidate.status),
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: candidate.cancel_at_period_end ?? false,
        ...(toStatus(candidate.status) !== "past_due" ? { graceEndsAt: null } : {}),
      },
    });
    await transaction.account.update({ where: { id: accountId }, data: { plan } });
  });
}

// "past_due uses a short documented grace state" (paid-beta plan §11). The
// grace deadline is set once on the first payment failure; Stripe's retry
// events must not roll it forward, or grace never ends.
const PAST_DUE_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

async function applyPaymentFailed(invoice: Stripe.Invoice, prisma: Db): Promise<void> {
  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return;
  const graceEndsAt = new Date(Date.now() + PAST_DUE_GRACE_DAYS * DAY_MS);
  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId, status: { not: "past_due" } },
    data: { status: "past_due", graceEndsAt },
  });
  // Backfill rows that entered past_due before a grace writer existed.
  await prisma.subscription.updateMany({
    where: { stripeCustomerId: customerId, status: "past_due", graceEndsAt: null },
    data: { graceEndsAt },
  });
}

async function applyEvent(
  event: Stripe.Event,
  prisma: Db,
  env: Env,
  stripe: Stripe,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await applyCheckoutCompleted(event.data.object as Stripe.Checkout.Session, prisma, env, stripe);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription, prisma, env, stripe);
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
  stripe: Stripe = getStripe(),
): Promise<void> {
  const already = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
  if (already) return;

  await applyEvent(event, prisma, env, stripe);

  await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
}
