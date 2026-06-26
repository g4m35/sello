import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  loadStripeConfig: vi.fn(),
  handleStripeEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/config", () => ({ loadStripeConfig: mocks.loadStripeConfig }));
vi.mock("@/lib/billing/webhook", () => ({ handleStripeEvent: mocks.handleStripeEvent }));
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: mocks.constructEvent } }),
}));

import { POST } from "./route";

function req(body: string, signature?: string) {
  const headers: Record<string, string> = {};
  if (signature !== undefined) headers["stripe-signature"] = signature;
  return new Request("https://app.test/api/billing/webhook", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadStripeConfig.mockReturnValue({ webhookSecret: "whsec_1" });
  mocks.constructEvent.mockReturnValue({ id: "evt_1", type: "customer.subscription.updated" });
  mocks.handleStripeEvent.mockResolvedValue(undefined);
});

describe("POST /api/billing/webhook", () => {
  it("verifies the signature and dispatches the event", async () => {
    const res = await POST(req("raw-body", "sig"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mocks.constructEvent).toHaveBeenCalledWith("raw-body", "sig", "whsec_1");
    expect(mocks.handleStripeEvent).toHaveBeenCalledTimes(1);
  });

  it("returns 400 on an invalid signature and does not dispatch", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const res = await POST(req("raw-body", "sig"));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SIGNATURE");
    expect(mocks.handleStripeEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when the signature header is missing", async () => {
    const res = await POST(req("raw-body"));

    expect(res.status).toBe(400);
    expect(mocks.handleStripeEvent).not.toHaveBeenCalled();
  });
});
