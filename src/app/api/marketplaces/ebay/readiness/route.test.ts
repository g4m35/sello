import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptEbayToken } from "@/lib/marketplace/adapters/ebay/token-crypto";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireSupabaseUserFromRequestOrCookies,
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
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
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
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
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

  it("refreshes readiness through production APIs using the stored production token", async () => {
    process.env.EBAY_ENV = "production";
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    const findUnique = vi.fn().mockResolvedValue({
      id: "connection-1",
      userId: "11111111-1111-4111-8111-111111111111",
      marketplace: "ebay",
      environment: "production",
      accessTokenEnc: encryptEbayToken("raw-production-access-token", key),
      refreshTokenEnc: encryptEbayToken("raw-production-refresh-token", key),
      accessTokenExpiresAt: new Date(Date.now() + 120_000),
      refreshTokenExpiresAt: null,
      scopes: [
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
      ],
    });
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique,
        update: vi.fn(),
      },
      ebaySellerConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockImplementation(({ create }) => create),
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ paymentPolicies: [] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ fulfillmentPolicies: [] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ returnPolicies: [] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ locations: [] })));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/marketplaces/ebay/readiness", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.environment).toBe("production");
    expect(payload.connected).toBe(true);
    expect(payload.ready).toBe(false);
    expect(payload.missing).toEqual([
      "payment_policy",
      "fulfillment_policy",
      "return_policy",
      "inventory_location",
    ]);
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_marketplace_environment: {
          userId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          environment: "production",
        },
      },
    });
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.ebay.com/sell/account/v1/payment_policy?marketplace_id=EBAY_US",
      "https://api.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US",
      "https://api.ebay.com/sell/account/v1/return_policy?marketplace_id=EBAY_US",
      "https://api.ebay.com/sell/inventory/v1/location",
    ]);
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer raw-production-access-token",
      );
    }
    expect(JSON.stringify(payload)).not.toContain("raw-production-access-token");
    expect(JSON.stringify(payload)).not.toContain("raw-production-refresh-token");
  });

  it("treats eBay policy 4xx (not opted into business policies) as missing setup, not a 502", async () => {
    process.env.EBAY_ENV = "production";
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection-1",
          userId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          environment: "production",
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
        upsert: vi.fn().mockImplementation(({ create }) => create),
      },
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ errorId: 20403 }] }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ errorId: 20403 }] }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ errorId: 20403 }] }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ locations: [] })));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/marketplaces/ebay/readiness", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(payload.ready).toBe(false);
    expect(payload.reconnectRequired).toBeUndefined();
    expect(payload.missing).toEqual([
      "payment_policy",
      "fulfillment_policy",
      "return_policy",
      "inventory_location",
    ]);
  });

  it("returns a structured reconnect-required result when the refresh token is revoked", async () => {
    process.env.EBAY_ENV = "production";
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection-1",
          userId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          environment: "production",
          accessTokenEnc: encryptEbayToken("raw-access-token", key),
          refreshTokenEnc: encryptEbayToken("raw-refresh-token", key),
          // Expired access token forces a refresh attempt.
          accessTokenExpiresAt: new Date(Date.now() - 60_000),
          refreshTokenExpiresAt: null,
          scopes: [],
        }),
        update: vi.fn(),
      },
      ebaySellerConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/marketplaces/ebay/readiness", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.reconnectRequired).toBe(true);
    expect(payload.connected).toBe(false);
    expect(payload.error.code).toBe("EBAY_RECONNECT_REQUIRED");
    // Only the token refresh call happened; no eBay API calls afterward.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(payload)).not.toContain("raw-refresh-token");
  });

  it("returns 502 with a typed error for real eBay 5xx failures", async () => {
    process.env.EBAY_ENV = "production";
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection-1",
          userId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
          environment: "production",
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
        upsert: vi.fn(),
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), { status: 500 }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/marketplaces/ebay/readiness", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe("EBAY_API_FAILED");
    expect(payload.error.message).toContain("HTTP 500");
  });
});
