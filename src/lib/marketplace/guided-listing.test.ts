import { describe, expect, it } from "vitest";

import { guidedListingMeta, isPlausibleListingUrl } from "./guided-listing";

describe("guidedListingMeta", () => {
  it("returns guided listing metadata for all five assisted marketplaces", () => {
    expect(guidedListingMeta("grailed")).toEqual({
      sellFormUrl: "https://www.grailed.com/sell/new",
      listingUrlHosts: ["grailed.com", "www.grailed.com"],
    });
    expect(guidedListingMeta("poshmark")).toEqual({
      sellFormUrl: "https://poshmark.com/create-listing",
      listingUrlHosts: ["poshmark.com", "www.poshmark.com"],
    });
    expect(guidedListingMeta("depop")).toEqual({
      sellFormUrl: "https://www.depop.com/products/create",
      listingUrlHosts: ["depop.com", "www.depop.com"],
    });
    expect(guidedListingMeta("vinted")).toEqual({
      sellFormUrl: "https://www.vinted.com/items/new",
      listingUrlHosts: ["vinted.com", "www.vinted.com"],
    });
    expect(guidedListingMeta("mercari")).toEqual({
      sellFormUrl: "https://www.mercari.com/sell/",
      listingUrlHosts: ["mercari.com", "www.mercari.com"],
    });
  });

  it("returns null for marketplaces without guided listing metadata", () => {
    for (const marketplace of [
      "ebay",
      "etsy",
      "stockx",
      "tiktok_shop",
    ] as const) {
      expect(guidedListingMeta(marketplace)).toBeNull();
    }
  });
});

describe("isPlausibleListingUrl", () => {
  it("accepts an HTTPS URL on an allowed host", () => {
    expect(
      isPlausibleListingUrl("grailed", "https://www.grailed.com/listings/123-x"),
    ).toBe(true);
  });

  it("accepts a subdomain of an allowed host", () => {
    expect(
      isPlausibleListingUrl("mercari", "https://us.mercari.com/item/m123"),
    ).toBe(true);
  });

  it("rejects non-HTTPS URLs", () => {
    expect(
      isPlausibleListingUrl("grailed", "http://www.grailed.com/listings/123-x"),
    ).toBe(false);
  });

  it.each([
    "https://example.com/listings/123-x",
    "https://notgrailed.com/listings/123-x",
    "https://grailed.com.example.com/listings/123-x",
    "https://www.grailed.com.example.com/listings/123-x",
  ])("rejects a wrong host: %s", (url) => {
    expect(isPlausibleListingUrl("grailed", url)).toBe(false);
  });

  it("rejects URLs for marketplaces without guided metadata", () => {
    expect(
      isPlausibleListingUrl("ebay", "https://www.grailed.com/listings/123-x"),
    ).toBe(false);
  });

  it.each(["garbage", "", "grailed.com/listings/123-x"])(
    "rejects an invalid URL: %s",
    (url) => {
      expect(isPlausibleListingUrl("grailed", url)).toBe(false);
    },
  );
});
