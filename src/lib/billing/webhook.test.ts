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
};

function fakePrisma(): { prisma: ReturnType<typeof import("@/lib/prisma").getPrisma>; fns: Fns } {
  const fns: Fns = {
    eventFind: vi.fn().mockResolvedValue(null),
    eventCreate: vi.fn().mockResolvedValue({}),
    subFind: vi.fn().mockResolvedValue({ accountId: "acc-1", stripeCustomerId: "cus_1" }),
    subUpdate: vi.fn().mockResolvedValue({}),
    subUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
    accountUpdate: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    stripeEvent: { findUnique: fns.eventFind, create: fns.eventCreate },
    subscription: { findUnique: fns.subFind, update: fns.subUpdate, updateMany: fns.subUpdateMany },
    account: { update: fns.accountUpdate },
  } as never;
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

describe("handleStripeEvent", () => {
  let prisma: ReturnType<typeof fakePrisma>["prisma"];
  let fns: Fns;

  beforeEach(() => {
    ({ prisma, fns } = fakePrisma());
  });

  it("sets plan + period from a subscription.created event", async () => {
    await handleStripeEvent(subscriptionEvent("customer.subscription.created"), prisma, env);

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
    await handleStripeEvent(
      subscriptionEvent("customer.subscription.updated", { priceId: "price_king" }),
      prisma,
      env,
    );
    expect(fns.subUpdate.mock.calls[0][0].data.plan).toBe("kingpin");
  });

  it("downgrades to free on subscription.deleted", async () => {
    await handleStripeEvent(
      subscriptionEvent("customer.subscription.deleted", { status: "canceled" }),
      prisma,
      env,
    );
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

    await handleStripeEvent(event, prisma, env);

    const arg = fns.subUpdateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ accountId: "acc-1" });
    expect(arg.data.stripeSubscriptionId).toBe("sub_9");
  });

  it("marks past_due on invoice.payment_failed without changing plan", async () => {
    const event = {
      id: "evt_invoice",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_1" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event, prisma, env);

    expect(fns.subUpdateMany.mock.calls[0][0].data).toEqual({ status: "past_due" });
    expect(fns.accountUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent: a duplicate delivery is a no-op", async () => {
    fns.eventFind.mockResolvedValue({ id: "evt_dup", type: "x" });

    await handleStripeEvent(subscriptionEvent("customer.subscription.created"), prisma, env);

    expect(fns.subUpdate).not.toHaveBeenCalled();
    expect(fns.eventCreate).not.toHaveBeenCalled();
  });
});
