import { describe, expect, it, vi } from "vitest";

import {
  createApifyEbaySoldSource,
  mapApifyEbaySoldItems,
} from "@/lib/comps/sources/apify-ebay-sold";
import type { CompQuery } from "@/lib/comps/source";

const query: CompQuery = {
  styleCode: null,
  brand: "The North Face",
  title: "The North Face Nuptse Black Puffer Jacket",
  size: "L",
  category: "streetwear",
  keywords: "the north face nuptse black puffer jacket sold",
  variants: [
    { kind: "strict", keywords: "the north face nuptse black puffer jacket sold" },
  ],
};

const enabledEnv = {
  COMPS_APIFY_EBAY_SOLD_ENABLED: "true",
  APIFY_TOKEN: "secret-apify-token",
  APIFY_EBAY_SOLD_ACTOR: "acme~ebay-sold-scraper",
};

function okResponse(items: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => items,
  } as unknown as Response;
}

describe("mapApifyEbaySoldItems", () => {
  it("maps tolerant Apify shapes into sold NormalizedComps", () => {
    const items = [
      {
        id: "v1|123|0",
        title: "The North Face Nuptse 700 Black Puffer Jacket Large",
        soldPrice: "$182.50",
        shippingPrice: 9.99,
        soldDate: "2026-06-01T00:00:00.000Z",
        itemUrl: "https://www.ebay.com/itm/123",
        image: "https://i.ebayimg.com/123.jpg",
        condition: "Pre-owned",
      },
      {
        itemId: "456",
        title: "TNF Nuptse Black M",
        price: { value: "150.00", currency: "USD" },
        url: "https://www.ebay.com/itm/456",
      },
    ];

    const comps = mapApifyEbaySoldItems(items, query);

    expect(comps).toHaveLength(2);
    expect(comps[0]).toMatchObject({
      source: "apify-ebay-sold",
      externalId: "v1|123|0",
      sold: true,
      priceCents: 18250,
      shippingCents: 999,
      soldDate: "2026-06-01T00:00:00.000Z",
      url: "https://www.ebay.com/itm/123",
      imageUrl: "https://i.ebayimg.com/123.jpg",
      currency: "USD",
    });
    expect(comps[0].rawJson).toEqual(items[0]);
    expect(comps[1]).toMatchObject({
      externalId: "456",
      priceCents: 15000,
      shippingCents: 0,
      sold: true,
    });
  });

  it("skips items with no usable price or title", () => {
    const comps = mapApifyEbaySoldItems(
      [
        { title: "No price here" },
        { price: 10 },
        { title: "Bad price", price: "free" },
        { title: "Non USD", price: { value: "10", currency: "EUR" } },
      ],
      query,
    );
    expect(comps).toHaveLength(0);
  });
});

describe("createApifyEbaySoldSource", () => {
  it("is disabled without the flag and token", () => {
    const source = createApifyEbaySoldSource({ env: {} });
    expect(source.isEnabled()).toBe(false);
  });

  it("returns [] without calling fetch when disabled", async () => {
    const fetchImpl = vi.fn();
    const source = createApifyEbaySoldSource({ env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await source.fetchComps(query)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns [] when enabled but no actor is configured", async () => {
    const fetchImpl = vi.fn();
    const source = createApifyEbaySoldSource({
      env: { COMPS_APIFY_EBAY_SOLD_ENABLED: "true", APIFY_TOKEN: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await source.fetchComps(query)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls the actor run-sync endpoint with the token in the Authorization header", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        okResponse([
          {
            id: "1",
            title: "TNF Nuptse Black L",
            soldPrice: 200,
            soldDate: "2026-06-02T00:00:00.000Z",
            url: "https://www.ebay.com/itm/1",
          },
        ]),
    );
    const source = createApifyEbaySoldSource({
      env: enabledEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const comps = await source.fetchComps(query);

    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ source: "apify-ebay-sold", sold: true, priceCents: 20000 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("api.apify.com/v2/acts/acme~ebay-sold-scraper/run-sync-get-dataset-items");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-apify-token");
    // Token must never be placed in the URL.
    expect(String(url)).not.toContain("secret-apify-token");
  });

  it("returns [] (never throws) when the actor call fails", async () => {
    const source = createApifyEbaySoldSource({
      env: enabledEnv,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    expect(await source.fetchComps(query)).toEqual([]);
  });

  it("returns [] on a non-OK response", async () => {
    const source = createApifyEbaySoldSource({
      env: enabledEnv,
      fetchImpl: (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch,
    });
    expect(await source.fetchComps(query)).toEqual([]);
  });
});
