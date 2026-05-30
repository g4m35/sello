import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptEbayToken } from "@/lib/marketplace/adapters/ebay/token-crypto";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { GET } from "./route";

describe("eBay readiness route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_REDIRECT_URI_NAME = "redirect-name";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
    process.env.EBAY_TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("returns sanitized missing-connection readiness", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      ebaySellerConfig: {
        findFirst: vi.fn(),
      },
    });

    const response = await GET(
      new Request("http://localhost/api/marketplaces/ebay/readiness"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(false);
    expect(payload.missing).toEqual(["oauth_connection"]);
    expect(JSON.stringify(payload)).not.toContain("Token");
  });

  it("refreshes readiness through sandbox APIs without exposing tokens", async () => {
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    const upsert = vi.fn().mockImplementation(({ create }) => create);
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection-1",
          userId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          environment: "sandbox",
          accessTokenEnc: encryptEbayToken("raw-access-token", key),
          refreshTokenEnc: encryptEbayToken("raw-refresh-token", key),
          accessTokenExpiresAt: new Date(Date.now() + 120_000),
          refreshTokenExpiresAt: null,
          scopes: [],
        }),
        update: vi.fn(),
      },
      ebaySellerConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert,
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ paymentPolicies: [{ paymentPolicyId: "pay-1" }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ fulfillmentPolicies: [{ fulfillmentPolicyId: "ship-1" }] }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ returnPolicies: [{ returnPolicyId: "return-1" }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            locations: [
              {
                merchantLocationKey: "warehouse-1",
                merchantLocationStatus: "ENABLED",
              },
            ],
          }),
        ),
      );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/marketplaces/ebay/readiness", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ready).toBe(true);
    expect(payload.config).toMatchObject({
      hasPaymentPolicy: true,
      hasFulfillmentPolicy: true,
      hasReturnPolicy: true,
      hasInventoryLocation: true,
    });
    expect(JSON.stringify(payload)).not.toContain("raw-access-token");
    expect(JSON.stringify(payload)).not.toContain("raw-refresh-token");
  });
});
