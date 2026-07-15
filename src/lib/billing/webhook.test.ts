import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleStripeEvent } from "./webhook";

const env = { STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_KINGPIN: "price_king" };

type Fns = {
  eventFind: ReturnType<typeof vi.fn>;
  eventCreate: ReturnType<typeof vi.fn>;
  subFind: ReturnType<typeof vi.fn>;
  subUpdate: ReturnType<typeof vi.fn>;
  subUpdateMany: ReturnType<typeof vi.fn>;
  accountUpdate: ReturnType<typeof vi.fn>;
  executeRaw: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function fakePrisma(): { prisma: ReturnType<typeof import("@/lib/prisma").getPrisma>; fns: Fns } {
  const fns: Fns = {
    eventFind: vi.fn().mockResolvedValue(null),
    eventCreate: vi.fn().mockResolvedValue({}),
    subFind: vi.fn().mockResolvedValue({
      accountId: "acc-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: null,
      status: "active",
    }),
    subUpdate: vi.fn().mockResolvedValue({}),
    subUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
    accountUpdate: vi.fn().mockResolvedValue({}),
    executeRaw: vi.fn().mockResolvedValue(1),
    transaction: vi.fn(),
  };
  const prisma = {
    stripeEvent: { findUnique: fns.eventFind, create: fns.eventCreate },
    subscription: { findUnique: fns.subFind, update: fns.subUpdate, updateMany: fns.subUpdateMany },
    account: { update: fns.accountUpdate },
    $executeRawUnsafe: fns.executeRaw,
  } as never;
  fns.transaction.mockImplementation(async (callback) => callback(prisma));
  Object.assign(prisma, { $transaction: fns.transaction });
  return { prisma, fns };
}

function subscriptionEvent(
  type: string,
  overrides: { status?: string; priceId?: string; cancelAtPeriodEnd?: boolean } = {},
): Stripe.Event {
  return {
    id: `evt_${type}`,
    type,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: overrides.status ?? "active",
        cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
        items: {
          data: [
            {
              price: { id: overrides.priceId ?? "price_pro" },
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

function currentSubscription(
  event: Stripe.Event,
  overrides: { id?: string; customer?: string; status?: string; priceId?: string } = {},
): Stripe.Subscription {
  const eventSubscription = event.data.object as Stripe.Subscription;
  return {
    ...eventSubscription,
    id: overrides.id ?? eventSubscription.id,
    customer: overrides.customer ?? eventSubscription.customer,
    status: overrides.status ?? eventSubscription.status,
    items: {
      ...eventSubscription.items,
      data: [
        {
          ...eventSubscription.items.data[0],
          price: {
            ...eventSubscription.items.data[0]?.price,
            id: overrides.priceId ?? eventSubscription.items.data[0]?.price.id,
          },
        } as Stripe.SubscriptionItem,
      ],
    },
  } as Stripe.Subscription;
}

function fakeStripe(subscription: Stripe.Subscription) {
  return {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
  } as unknown as Stripe;
}

describe("handleStripeEvent", () => {
  let prisma: ReturnType<typeof fakePrisma>["prisma"];
  let fns: Fns;

  beforeEach(() => {
    ({ prisma, fns } = fakePrisma());
  });

  it("sets plan + period from a subscription.created event", async () => {
    const event = subscriptionEvent("customer.subscription.created");
    await handleStripeEvent(event, prisma, env, fakeStripe(currentSubscription(event)));

    const upd = fns.subUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ stripeCustomerId: "cus_1" });
    expect(upd.data.plan).toBe("pro");
    expect(upd.data.status).toBe("active");
    expect(upd.data.stripeSubscriptionId).toBe("sub_1");
    expect(upd.data.currentPeriodEnd).toEqual(new Date(1_702_592_000 * 1000));
    expect(fns.accountUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { plan: "pro" },
    });
    expect(fns.eventCreate).toHaveBeenCalledTimes(1);
  });

  it("maps the kingpin price to the kingpin plan", async () => {
    const event = subscriptionEvent("customer.subscription.updated", { priceId: "price_king" });
    await handleStripeEvent(event, prisma, env, fakeStripe(currentSubscription(event)));
    expect(fns.subUpdate.mock.calls[0][0].data.plan).toBe("kingpin");
  });

  it("downgrades to free on subscription.deleted", async () => {
    const event = subscriptionEvent("customer.subscription.deleted", { status: "canceled" });
    await handleStripeEvent(event, prisma, env, fakeStripe(currentSubscription(event)));
    expect(fns.subUpdate.mock.calls[0][0].data.plan).toBe("free");
    expect(fns.subUpdate.mock.calls[0][0].data.status).toBe("canceled");
    expect(fns.accountUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { plan: "free" },
    });
  });

  it("binds the subscription id on checkout.session.completed", async () => {
    const event = {
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "acc-1", subscription: "sub_9", customer: "cus_1" } },
    } as unknown as Stripe.Event;

    const candidateEvent = subscriptionEvent("customer.subscription.created");
    await handleStripeEvent(
      event,
      prisma,
      env,
      fakeStripe(currentSubscription(candidateEvent, { id: "sub_9" })),
    );

    const arg = fns.subUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ accountId: "acc-1" });
    expect(arg.data.stripeSubscriptionId).toBe("sub_9");
    expect(arg.data.plan).toBe("pro");
    expect(fns.accountUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { plan: "pro" },
    });
  });

  it("marks past_due on invoice.payment_failed without changing plan", async () => {
    const event = {
      id: "evt_invoice",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_1" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event, prisma, env, fakeStripe({} as Stripe.Subscription));

    expect(fns.subUpdateMany.mock.calls[0][0].data).toEqual({ status: "past_due" });
    expect(fns.accountUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent: a duplicate delivery is a no-op", async () => {
    fns.eventFind.mockResolvedValue({ id: "evt_dup", type: "x" });

    const event = subscriptionEvent("customer.subscription.created");
    await handleStripeEvent(event, prisma, env, fakeStripe(currentSubscription(event)));

    expect(fns.subUpdate).not.toHaveBeenCalled();
    expect(fns.eventCreate).not.toHaveBeenCalled();
  });

  it("reconciles an out-of-order active event to Stripe's current canceled state", async () => {
    fns.subFind.mockResolvedValue({
      accountId: "acc-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
    });
    const staleEvent = subscriptionEvent("customer.subscription.updated", { status: "active" });
    const current = currentSubscription(staleEvent, { status: "canceled" });

    await handleStripeEvent(staleEvent, prisma, env, fakeStripe(current));

    expect(fns.subUpdate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ plan: "free", status: "canceled" }),
    );
    expect(fns.accountUpdate).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { plan: "free" },
    });
  });

  it("records but ignores events for a noncanonical subscription", async () => {
    fns.subFind.mockResolvedValue({
      accountId: "acc-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_canonical",
      status: "active",
    });
    const event = subscriptionEvent("customer.subscription.created");
    const noncanonical = currentSubscription(event, { id: "sub_other" });

    await handleStripeEvent(event, prisma, env, fakeStripe(noncanonical));

    expect(fns.subUpdate).not.toHaveBeenCalled();
    expect(fns.accountUpdate).not.toHaveBeenCalled();
    expect(fns.eventCreate).toHaveBeenCalledTimes(1);
  });

  it("does not bind checkout from a different Stripe customer", async () => {
    const event = {
      id: "evt_wrong_customer",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "acc-1",
          subscription: "sub_other",
          customer: "cus_other",
        },
      },
    } as unknown as Stripe.Event;
    const candidateEvent = subscriptionEvent("customer.subscription.created");
    const candidate = currentSubscription(candidateEvent, {
      id: "sub_other",
      customer: "cus_other",
    });

    await handleStripeEvent(event, prisma, env, fakeStripe(candidate));

    expect(fns.subUpdate).not.toHaveBeenCalled();
    expect(fns.eventCreate).toHaveBeenCalledTimes(1);
  });
});
