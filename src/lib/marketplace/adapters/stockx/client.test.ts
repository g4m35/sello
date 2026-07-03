import { describe, expect, it, vi } from "vitest";

import {
  activateStockXListing,
  createStockXListing,
  deactivateStockXListing,
  fetchStockXMarketData,
  searchStockXCatalog,
} from "./client";
import { StockXIntegrationError, toStockXErrorPayload } from "./errors";
import type { StockXConfig } from "./types";

const config: StockXConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://sello.wtf/api/marketplaces/stockx/callback",
  apiBaseUrl: "https://api.stockx.com/v2",
  authBaseUrl: "https://accounts.stockx.com",
  apiKey: "api-key",
  scopes: ["offline_access", "openid"],
  tokenEncryptionKey: "a".repeat(64),
};

describe("StockX catalog client", () => {
  it("adds Bearer and x-api-key headers and normalizes product variants", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            products: [
              {
                id: "p1",
                title: "Nike Dunk Low Panda",
                brand: "Nike",
                styleId: "DD1391-100",
                colorway: "White Black",
                slug: "nike-dunk-low-panda",
                media: { imageUrl: "https://images.stockx.com/panda.jpg" },
                variants: [{ id: "v1", size: "10" }],
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const results = await searchStockXCatalog(
      config,
      "access-token",
      { query: "dunk panda", size: "10" },
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.stockx.com/v2/catalog/search?q=dunk+panda&size=10");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-token");
    expect(headers["x-api-key"]).toBe("api-key");
    expect(results[0]).toMatchObject({
      productId: "p1",
      variantId: "v1",
      title: "Nike Dunk Low Panda",
      brand: "Nike",
      style: "DD1391-100",
      size: "10",
      url: "https://stockx.com/nike-dunk-low-panda",
    });
  });

  it("retries only idempotent GET failures and never leaks raw upstream payloads", async () => {
    const fetchImpl = vi
      .fn<(...args: Parameters<typeof fetch>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("raw secret upstream body", { status: 500 }))
      .mockResolvedValueOnce(new Response("raw secret upstream body", { status: 500 }));

    try {
      await searchStockXCatalog(
        config,
        "access-token",
        { query: "dunk" },
        fetchImpl as unknown as typeof fetch,
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StockXIntegrationError);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const { payload } = toStockXErrorPayload(error);
      expect(JSON.stringify(payload)).not.toContain("secret");
      expect(payload.message).toBe("StockX API request failed.");
    }
  });
});

describe("StockX market data client", () => {
  it("normalizes recent sale rows into market data points", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              title: "Nike Dunk Low Panda",
              sales: [
                {
                  saleId: "s1",
                  price: 120,
                  currency: "USD",
                  soldAt: "2026-06-20T00:00:00.000Z",
                  size: "10",
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );

    const rows = await fetchStockXMarketData(
      config,
      "access-token",
      { productId: "p1", variantId: "v1" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(rows[0]).toMatchObject({
      externalId: "s1",
      title: "Nike Dunk Low Panda",
      priceCents: 12000,
      soldDate: "2026-06-20T00:00:00.000Z",
      size: "10",
    });
  });
});

describe("StockX listing client", () => {
  it("creates a listing through the official selling/listings endpoint", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            id: "listing-1",
            status: "CREATED",
          }),
          { status: 201 },
        ),
    );

    const result = await createStockXListing(
      config,
      "access-token",
      { amount: "125.00", variantId: "variant-1" },
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.stockx.com/v2/selling/listings");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: "125.00",
      variantId: "variant-1",
    });
    expect(result).toMatchObject({ listingId: "listing-1", status: "CREATED" });
  });

  it("activates a created listing and normalizes the operation response", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            listingId: "listing-1",
            operationId: "operation-1",
            operationStatus: "PENDING",
            operationUrl:
              "https://api.stockx.com/v2/selling/listings/listing-1/operations/operation-1",
          }),
          { status: 202 },
        ),
    );

    const result = await activateStockXListing(
      config,
      "access-token",
      "listing-1",
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.stockx.com/v2/selling/listings/listing-1/activate",
    );
    expect(init?.method).toBe("POST");
    expect(result).toMatchObject({
      listingId: "listing-1",
      operationId: "operation-1",
      operationStatus: "PENDING",
    });
  });

  it("does not retry listing creation failures because POST is not idempotent", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () => new Response("raw provider body", { status: 500 }),
    );

    await expect(
      createStockXListing(
        config,
        "access-token",
        { amount: "125.00", variantId: "variant-1" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: "STOCKX_LISTING_FAILED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("deactivates a live listing through the official deactivate endpoint", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            listingId: "listing-1",
            operationId: "operation-2",
            operationStatus: "PENDING",
          }),
          { status: 202 },
        ),
    );

    const result = await deactivateStockXListing(
      config,
      "access-token",
      "listing-1",
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.stockx.com/v2/selling/listings/listing-1/deactivate",
    );
    expect(init?.method).toBe("PUT");
    expect(result).toMatchObject({
      listingId: "listing-1",
      operationId: "operation-2",
      operationStatus: "PENDING",
    });
  });
});
