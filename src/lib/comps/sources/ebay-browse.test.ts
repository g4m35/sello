import { afterEach, describe, expect, it, vi } from "vitest";

import { ebayBrowseSource } from "./ebay-browse";
import type { CompQuery } from "@/lib/comps/source";

const query: CompQuery = {
  styleCode: null,
  brand: "The North Face",
  title: "The North Face Black Nuptse Puffer Jacket",
  size: "Large",
  category: "streetwear",
  keywords: "The North Face Nuptse Large sold",
  variants: [
    { kind: "strict", keywords: "The North Face Nuptse Large sold" },
    { kind: "broad", keywords: "The North Face black puffer jacket preowned" },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ebayBrowseSource", () => {
  it("stays disabled until both auto discovery and eBay search flags are enabled", () => {
    vi.stubEnv("EBAY_CLIENT_ID", "client");
    vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
    vi.stubEnv("PRICE_COMP_AUTO_DISCOVERY_ENABLED", "true");
    vi.stubEnv("PRICE_COMP_EBAY_SEARCH_ENABLED", "");
    expect(ebayBrowseSource.isEnabled()).toBe(false);

    vi.stubEnv("PRICE_COMP_EBAY_SEARCH_ENABLED", "true");
    expect(ebayBrowseSource.isEnabled()).toBe(true);
  });

  it("uses application OAuth, timeouts, and normalizes safe public active listings", async () => {
    vi.stubEnv("EBAY_CLIENT_ID", "client");
    vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
    vi.stubEnv("PRICE_COMP_AUTO_DISCOVERY_ENABLED", "true");
    vi.stubEnv("PRICE_COMP_EBAY_SEARCH_ENABLED", "true");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "app-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            itemSummaries: [
              {
                itemId: "v1|123",
                title: "The North Face Nuptse Black Puffer Jacket Large",
                price: { value: "185.00", currency: "USD" },
                itemWebUrl: "https://www.ebay.com/itm/123",
                image: { imageUrl: "https://i.ebayimg.com/images/123.jpg" },
                condition: "Pre-owned",
                shippingOptions: [{ shippingCost: { value: "12.50", currency: "USD" } }],
              },
              {
                itemId: "v1|bad",
                title: "Wrong currency",
                price: { value: "100.00", currency: "EUR" },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const comps = await ebayBrowseSource.fetchComps(query);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("item_summary/search");
    expect(String(fetchMock.mock.calls[1][0])).toContain("The%20North%20Face");
    expect(comps).toEqual([
      expect.objectContaining({
        source: "ebay-browse",
        externalId: "v1|123",
        title: "The North Face Nuptse Black Puffer Jacket Large",
        priceCents: 18500,
        shippingCents: 1250,
        sold: false,
        condition: "used_good",
        currency: "USD",
        imageUrl: "https://i.ebayimg.com/images/123.jpg",
      }),
    ]);
  });
});
