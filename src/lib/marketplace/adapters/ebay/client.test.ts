import { describe, expect, it, vi } from "vitest";

import {
  EbaySandboxClient,
  getEbayApplicationAccessToken,
  getUsableEbayAccessToken,
  type EbayTokenPrismaLike,
} from "./client";
import { decryptEbayToken, encryptEbayToken } from "./token-crypto";

const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const config = {
  environment: "sandbox" as const,
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUriName: "redirect-name",
  marketplaceId: "EBAY_US" as const,
  tokenEncryptionKey: key,
};

describe("eBay sandbox client", () => {
  it("normalizes API failures without exposing bearer tokens", async () => {
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", async () =>
      new Response(JSON.stringify({ errors: [{ errorId: 1 }] }), { status: 500 }),
    );

    await expect(client.listPaymentPolicies()).rejects.toMatchObject({
      code: "EBAY_API_FAILED",
      status: 502,
    });
    await expect(client.listPaymentPolicies()).rejects.not.toThrow(
      "secret-access-token",
    );
  });

  it("creates inventory locations via POST to the location endpoint", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", fetchImpl, "production");

    await client.createInventoryLocation("sello-default-location", {
      name: "Default location",
      location: {
        address: {
          addressLine1: "123 Main St",
          city: "San Francisco",
          stateOrProvince: "CA",
          postalCode: "94103",
          country: "US",
        },
      },
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
    });

    expect(calls[0].url).toBe(
      "https://api.ebay.com/sell/inventory/v1/location/sello-default-location",
    );
    expect(calls[0].init?.method).toBe("POST");
  });

  it("surfaces eBay's own message when location creation fails with 4xx", async () => {
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", async () =>
      new Response(
        JSON.stringify({ errors: [{ message: "Invalid postal code." }] }),
        { status: 400 },
      ),
    );

    await expect(
      client.createInventoryLocation("sello-default-location", {
        name: "x",
        location: {
          address: {
            addressLine1: "1",
            city: "c",
            stateOrProvince: "CA",
            postalCode: "00000",
            country: "US",
          },
        },
        locationTypes: ["WAREHOUSE"],
        merchantLocationStatus: "ENABLED",
      }),
    ).rejects.toMatchObject({
      code: "EBAY_LOCATION_CREATE_FAILED",
      status: 422,
      message: expect.stringContaining("Invalid postal code."),
    });
  });

  it("maps eBay 401 responses to a reconnect-required error", async () => {
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", async () =>
      new Response(JSON.stringify({ errors: [{ errorId: 1001 }] }), { status: 401 }),
    );

    await expect(client.listPaymentPolicies()).rejects.toMatchObject({
      code: "EBAY_RECONNECT_REQUIRED",
    });
  });

  it("includes the upstream status in API failure messages", async () => {
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", async () =>
      new Response(JSON.stringify({ errors: [{ errorId: 20403 }] }), { status: 403 }),
    );

    await expect(client.listPaymentPolicies()).rejects.toMatchObject({
      code: "EBAY_API_FAILED",
      details: { status: 403 },
    });
  });

  it("maps revoked refresh tokens to a reconnect-required error", async () => {
    const prisma: EbayTokenPrismaLike = {
      marketplaceConnection: { update: vi.fn() },
    };

    await expect(
      getUsableEbayAccessToken(
        prisma,
        {
          id: "connection-1",
          accessTokenEnc: encryptEbayToken("expired-access-token", key),
          refreshTokenEnc: encryptEbayToken("revoked-refresh-token", key),
          accessTokenExpiresAt: new Date(Date.now() - 60_000),
        },
        config,
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      ),
    ).rejects.toMatchObject({ code: "EBAY_RECONNECT_REQUIRED" });
  });

  it("keeps eBay 5xx refresh failures as typed refresh errors", async () => {
    const prisma: EbayTokenPrismaLike = {
      marketplaceConnection: { update: vi.fn() },
    };

    await expect(
      getUsableEbayAccessToken(
        prisma,
        {
          id: "connection-1",
          accessTokenEnc: encryptEbayToken("expired-access-token", key),
          refreshTokenEnc: encryptEbayToken("refresh-token", key),
          accessTokenExpiresAt: new Date(Date.now() - 60_000),
        },
        config,
        async () => new Response(JSON.stringify({}), { status: 503 }),
      ),
    ).rejects.toMatchObject({ code: "EBAY_TOKEN_REFRESH_FAILED" });
  });

  it("targets the production API host when constructed for production", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ paymentPolicies: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new EbaySandboxClient(
      "secret-access-token",
      "EBAY_US",
      fetchImpl,
      "production",
    );

    await client.listPaymentPolicies();

    expect(urls[0].startsWith("https://api.ebay.com/")).toBe(true);
  });

  it("defaults to the sandbox API host", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ paymentPolicies: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", fetchImpl);

    await client.listPaymentPolicies();

    expect(urls[0].startsWith("https://api.sandbox.ebay.com/")).toBe(true);
  });

  it("fetches Taxonomy aspects for a category with marketplace headers", async () => {
    const urls: string[] = [];
    const inits: RequestInit[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      inits.push(init ?? {});
      return new Response(
        JSON.stringify({
          aspects: [
            {
              localizedAspectName: "Type",
              aspectConstraint: { aspectRequired: true },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new EbaySandboxClient(
      "secret-access-token",
      "EBAY_US",
      fetchImpl,
      "production",
    );

    const aspects = await client.getItemAspectsForCategory("57988");

    expect(urls[0]).toBe(
      "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=57988",
    );
    expect(inits[0].headers).toMatchObject({
      Authorization: "Bearer secret-access-token",
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
    });
    expect(aspects).toEqual([
      {
        localizedAspectName: "Type",
        aspectConstraint: { aspectRequired: true },
      },
    ]);
  });

  it("refreshes expired access tokens and stores encrypted replacement tokens", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: EbayTokenPrismaLike = {
      marketplaceConnection: { update },
    };

    const accessToken = await getUsableEbayAccessToken(
      prisma,
      {
        id: "connection-1",
        accessTokenEnc: encryptEbayToken("expired-access-token", key),
        refreshTokenEnc: encryptEbayToken("refresh-token", key),
        accessTokenExpiresAt: new Date(Date.now() - 60_000),
      },
      config,
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
            expires_in: 7200,
            refresh_token_expires_in: 86400,
            scope: "scope-a scope-b",
          }),
          { status: 200 },
        ),
    );

    expect(accessToken).toBe("fresh-access-token");
    const data = update.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toContain("fresh-access-token");
    expect(decryptEbayToken(data.accessTokenEnc, key)).toBe("fresh-access-token");
    expect(decryptEbayToken(data.refreshTokenEnc, key)).toBe(
      "fresh-refresh-token",
    );
  });

  it("gets an application access token for read-only Taxonomy calls", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const token = await getEbayApplicationAccessToken(config, async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ access_token: "app-token", expires_in: 7200 }), {
        status: 200,
      });
    });

    expect(token).toBe("app-token");
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    );
    expect(calls[0].init?.body?.toString()).toContain(
      "grant_type=client_credentials",
    );
    expect(calls[0].init?.body?.toString()).toContain(
      "scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    );
  });
});

describe("eBay sandbox publish methods", () => {
  type Call = { url: string; init: RequestInit };

  function recordingClient(responses: Response[]) {
    const calls: Call[] = [];
    let i = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const response = responses[i] ?? new Response(null, { status: 204 });
      i += 1;
      return response;
    }) as unknown as typeof fetch;
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", fetchImpl);
    return { client, calls };
  }

  it("PUTs createOrReplaceInventoryItem to the inventory_item/{sku} path", async () => {
    const { client, calls } = recordingClient([new Response(null, { status: 204 })]);

    await client.createOrReplaceInventoryItem("percs_item-1", {
      condition: "NEW_WITH_TAGS",
    } as never);

    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/percs_item-1",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-access-token");
    expect(headers["Content-Language"]).toBe("en-US");
    expect(headers["Accept-Language"]).toBe("en-US");
  });

  it("POSTs createOffer to the offer path and returns the offerId", async () => {
    const { client, calls } = recordingClient([
      new Response(JSON.stringify({ offerId: "offer-123" }), { status: 201 }),
    ]);

    const result = await client.createOffer({ sku: "percs_item-1" } as never);

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/offer",
    );
    expect(result.offerId).toBe("offer-123");
  });

  it("POSTs publishOffer to the publish path and returns the listingId", async () => {
    const { client, calls } = recordingClient([
      new Response(JSON.stringify({ listingId: "listing-999" }), { status: 200 }),
    ]);

    const result = await client.publishOffer("offer-123");

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/offer/offer-123/publish/",
    );
    expect(result.listingId).toBe("listing-999");
  });

  it("POSTs withdrawOffer to the withdraw path and returns the listingId when present", async () => {
    const { client, calls } = recordingClient([
      new Response(JSON.stringify({ listingId: "listing-999" }), { status: 200 }),
    ]);

    const result = await client.withdrawOffer("offer-123");

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/offer/offer-123/withdraw",
    );
    expect(result.listingId).toBe("listing-999");
  });

  it("normalizes withdraw failures to a typed eBay delist error", async () => {
    const { client } = recordingClient([
      new Response(JSON.stringify({ errors: [{ errorId: 25725 }] }), { status: 400 }),
    ]);

    await expect(client.withdrawOffer("offer-123")).rejects.toMatchObject({
      code: "EBAY_DELIST_FAILED",
      status: 502,
    });
  });

  it("normalizes publish failures to a typed error without leaking the token", async () => {
    const { client } = recordingClient([
      new Response(
        JSON.stringify({
          errors: [
            {
              errorId: 25001,
              domain: "API_INVENTORY",
              category: "REQUEST",
              message: "Invalid policy.",
              longMessage: "Fulfillment policy was not found.",
              parameters: [{ name: "fulfillmentPolicyId", value: "secret-access-token" }],
            },
          ],
        }),
        { status: 400 },
      ),
    ]);

    await expect(client.publishOffer("offer-123")).rejects.toMatchObject({
      code: "EBAY_PUBLISH_FAILED",
      status: 502,
      details: {
        status: 400,
        ebayError: {
          status: 400,
          message: "Fulfillment policy was not found.",
          errors: [
            expect.objectContaining({
              errorId: "25001",
              domain: "API_INVENTORY",
              category: "REQUEST",
              longMessage: "Fulfillment policy was not found.",
              parameters: [{ name: "fulfillmentPolicyId", value: "[redacted]" }],
            }),
          ],
        },
      },
    });
    await expect(
      client.createOffer({ sku: "x" } as never),
    ).rejects.not.toThrow("secret-access-token");
  });

  it("normalizes text publish failures with status and body excerpt", async () => {
    const { client } = recordingClient([
      new Response("upstream unavailable", { status: 503 }),
    ]);

    await expect(client.createOffer({ sku: "x" } as never)).rejects.toMatchObject({
      code: "EBAY_PUBLISH_FAILED",
      details: {
        status: 503,
        ebayError: {
          status: 503,
          message: "upstream unavailable",
          rawText: "upstream unavailable",
        },
      },
    });
  });

  it("reads inventory items and offers by SKU for orphan reconciliation", async () => {
    const { client, calls } = recordingClient([
      new Response(JSON.stringify({ sku: "percs_item-1" }), { status: 200 }),
      new Response(JSON.stringify({ offers: [{ offerId: "offer-1" }] }), {
        status: 200,
      }),
    ]);

    await expect(client.getInventoryItem("percs_item-1")).resolves.toMatchObject({
      sku: "percs_item-1",
    });
    await expect(client.getOffersBySku("percs_item-1")).resolves.toEqual([
      { offerId: "offer-1" },
    ]);

    expect(calls[0].init.method).toBeUndefined();
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/percs_item-1",
    );
    expect(calls[1].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/offer?sku=percs_item-1",
    );
  });

  it("treats a missing SKU offer lookup as no offers", async () => {
    const { client } = recordingClient([
      new Response(JSON.stringify({ errors: [{ errorId: 25710 }] }), {
        status: 404,
      }),
    ]);

    await expect(client.getOffersBySku("percsitem1")).resolves.toEqual([]);
  });

  it("deletes unpublished offers and inventory items for guarded cleanup", async () => {
    const { client, calls } = recordingClient([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);

    await client.deleteOffer("offer-1");
    await client.deleteInventoryItem("percs_item-1");

    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/offer/offer-1",
    );
    expect(calls[1].init.method).toBe("DELETE");
    expect(calls[1].url).toBe(
      "https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/percs_item-1",
    );
  });
});
