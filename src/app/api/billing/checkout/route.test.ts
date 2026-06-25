import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  ensureStripeCustomer: vi.fn(),
  loadStripeConfig: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/billing/customer", () => ({
  ensureStripeCustomer: mocks.ensureStripeCustomer,
}));
vi.mock("@/lib/billing/config", () => ({ loadStripeConfig: mocks.loadStripeConfig }));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: mocks.sessionsCreate } } }),
}));

import { AppError } from "@/lib/errors";

import { POST } from "./route";

function req(body: unknown, origin = "https://app.test") {
  return new Request("https://app.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
  mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
  mocks.ensureStripeCustomer.mockResolvedValue("cus_1");
  mocks.loadStripeConfig.mockReturnValue({
    priceIds: { pro: "price_pro", kingpin: "price_king" },
  });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe/session" });
});

describe("POST /api/billing/checkout", () => {
  it("creates a subscription checkout session bound to the account", async () => {
    const res = await POST(req({ plan: "pro" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe/session" });
    const arg = mocks.sessionsCreate.mock.calls[0][0];
    expect(arg.mode).toBe("subscription");
    expect(arg.customer).toBe("cus_1");
    expect(arg.client_reference_id).toBe("acc-1");
    expect(arg.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    expect(arg.success_url).toContain("/settings/billing");
    expect(arg.cancel_url).toContain("/pricing");
  });

  it("rejects the free plan with a typed 400", async () => {
    const res = await POST(req({ plan: "free" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("FREE_PLAN_NOT_CHECKOUT");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in.", 401));

    const res = await POST(req({ plan: "pro" }));

    expect(res.status).toBe(401);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
