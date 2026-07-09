import { describe, expect, it, vi } from "vitest";

import {
  activateStockXListing,
  createStockXListing,
  deactivateStockXListing,
  deleteStockXListing,
  fetchStockXListingStatus,
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
    expect(String(url)).toBe(
      "https://api.stockx.com/v2/catalog/search?query=dunk+panda&pageNumber=1&pageSize=5",
    );
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

  it("enriches product-only catalog search results with product variant details", async () => {
    const fetchImpl = vi
      .fn<(...args: Parameters<typeof fetch>) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            products: [
              {
                productId: "p1",
                title: "Nike Dunk Low Panda",
                brand: "Nike",
                urlKey: "nike-dunk-low-panda",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            variants: [
              { variantId: "v9", traits: { size: "9" } },
              { variantId: "v10", traits: { size: "10" } },
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

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toBe(
      "https://api.stockx.com/v2/catalog/products/p1/variants",
    );
    expect(results).toEqual([
      expect.objectContaining({
        productId: "p1",
        variantId: "v10",
        title: "Nike Dunk Low Panda",
        size: "10",
      }),
    ]);
  });

  it("applies size filtering before truncating enriched variant results", async () => {
    const variants = Array.from({ length: 20 }, (_, index) => ({
      variantId: `v${index + 1}`,
      traits: { size: index === 18 ? "10" : `early-${index + 1}` },
    }));
    const fetchImpl = vi
      .fn<(...args: Parameters<typeof fetch>) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            products: [{ productId: "p1", title: "Nike Dunk Low Panda", brand: "Nike" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ variants }), { status: 200 }));

    const results = await searchStockXCatalog(
      config,
      "access-token",
      { query: "dunk panda", size: "10" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ variantId: "v19", size: "10" });
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
  it("requests currencyCode and normalizes ask/bid market levels", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              productId: "p1",
              variantId: "v1",
              currencyCode: "USD",
              lowestAskAmount: 120,
              highestBidAmount: 95,
              sellFasterAmount: 110,
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

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("currencyCode=USD");
    expect(rows[0]).toMatchObject({
      priceCents: 12000,
      currency: "USD",
      soldDate: null,
    });
    expect(rows.some((row) => row.priceCents === 9500)).toBe(true);
  });

  it("still normalizes legacy sale-history rows when present", async () => {
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
      {
        amount: "125",
        variantId: "variant-1",
        currencyCode: "USD",
        active: true,
        inventoryType: "STANDARD",
      },
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.stockx.com/v2/selling/listings");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: "125",
      variantId: "variant-1",
      currencyCode: "USD",
      active: true,
      inventoryType: "STANDARD",
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
    expect(init?.method).toBe("PUT");
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
        {
          amount: "125",
          variantId: "variant-1",
          currencyCode: "USD",
          active: true,
          inventoryType: "STANDARD",
        },
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

  it("deletes a listing through the official delete endpoint", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () => new Response("", { status: 200 }),
    );

    const result = await deleteStockXListing(
      config,
      "access-token",
      "listing-1",
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.stockx.com/v2/selling/listings/listing-1");
    expect(init?.method).toBe("DELETE");
    expect(result).toMatchObject({
      listingId: "listing-1",
      status: null,
    });
  });

  it("fetches a listing status for reconciliation", async () => {
    const fetchImpl = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              listing: {
                id: "listing-1",
                status: "ACTIVE",
              },
            },
          }),
          { status: 200 },
        ),
    );

    const result = await fetchStockXListingStatus(
      config,
      "access-token",
      "listing-1",
      fetchImpl as unknown as typeof fetch,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.stockx.com/v2/selling/listings/listing-1");
    expect(init?.method).toBe("GET");
    expect(result).toMatchObject({
      listingId: "listing-1",
      status: "ACTIVE",
    });
  });
});
