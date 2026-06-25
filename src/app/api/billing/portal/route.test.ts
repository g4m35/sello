import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  findUnique: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ subscription: { findUnique: mocks.findUnique } }),
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: mocks.portalCreate } } }),
}));

import { POST } from "./route";

function req(origin = "https://app.test") {
  return new Request("https://app.test/api/billing/portal", {
    method: "POST",
    headers: { origin },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "s@e.com" });
  mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "pro" });
  mocks.findUnique.mockResolvedValue({ stripeCustomerId: "cus_1" });
  mocks.portalCreate.mockResolvedValue({ url: "https://billing.stripe/portal" });
});

describe("POST /api/billing/portal", () => {
  it("returns a portal url for an account with a customer", async () => {
    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe/portal" });
    const arg = mocks.portalCreate.mock.calls[0][0];
    expect(arg.customer).toBe("cus_1");
    expect(arg.return_url).toContain("/settings/billing");
  });

  it("returns 409 when the account has no billing customer yet", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const res = await POST(req());

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_BILLING_CUSTOMER");
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });
});
