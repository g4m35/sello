import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureStripeCustomer } from "./customer";

function deps(opts: {
  existingCustomerId?: string | null;
  createdCustomerId?: string;
}) {
  const findUnique = vi.fn().mockResolvedValue(
    opts.existingCustomerId === undefined
      ? null
      : { accountId: "acc-1", stripeCustomerId: opts.existingCustomerId },
  );
  const upsert = vi.fn().mockResolvedValue({});
  const customersCreate = vi
    .fn()
    .mockResolvedValue({ id: opts.createdCustomerId ?? "cus_new" });

  const prisma = { subscription: { findUnique, upsert } } as never;
  const stripe = { customers: { create: customersCreate } } as never;
  return { prisma, stripe, findUnique, upsert, customersCreate };
}

describe("ensureStripeCustomer", () => {
  it("reuses the persisted customer id and does not call Stripe", async () => {
    const { prisma, stripe, customersCreate, upsert } = deps({
      existingCustomerId: "cus_existing",
    });

    const id = await ensureStripeCustomer(
      { id: "acc-1" },
      "seller@example.com",
      prisma,
      stripe,
    );

    expect(id).toBe("cus_existing");
    expect(customersCreate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("creates a Stripe customer and persists it when none exists", async () => {
    const { prisma, stripe, customersCreate, upsert } = deps({
      existingCustomerId: undefined,
      createdCustomerId: "cus_made",
    });

    const id = await ensureStripeCustomer(
      { id: "acc-1" },
      "seller@example.com",
      prisma,
      stripe,
    );

    expect(id).toBe("cus_made");
    expect(customersCreate).toHaveBeenCalledWith({
      email: "seller@example.com",
      metadata: { accountId: "acc-1" },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ accountId: "acc-1" });
    expect(arg.create.stripeCustomerId).toBe("cus_made");
  });
});
