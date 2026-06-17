import { describe, expect, it } from "vitest";

import {
  compsAutoMinIdentityConfidence,
  compsMaxProviderResults,
  compsMaxQueryVariants,
  isApifyEbaySoldEnabled,
  isCompsAutoDiscoveryEnabled,
  isEbayActiveEnabled,
  isSerpapiEbayActiveEnabled,
} from "@/lib/comps/flags";

describe("comps provider flags", () => {
  describe("auto discovery (global kill switch)", () => {
    it("is on for the canonical COMPS_AUTO_DISCOVERY_ENABLED", () => {
      expect(isCompsAutoDiscoveryEnabled({ COMPS_AUTO_DISCOVERY_ENABLED: "true" })).toBe(true);
    });
    it("is on for the legacy PRICE_COMP_AUTO_DISCOVERY_ENABLED", () => {
      expect(isCompsAutoDiscoveryEnabled({ PRICE_COMP_AUTO_DISCOVERY_ENABLED: "true" })).toBe(true);
    });
    it("is off by default and for any non-'true' value", () => {
      expect(isCompsAutoDiscoveryEnabled({})).toBe(false);
      expect(isCompsAutoDiscoveryEnabled({ COMPS_AUTO_DISCOVERY_ENABLED: "1" })).toBe(false);
    });
  });

  describe("apify ebay sold", () => {
    it("requires both the enable flag and APIFY_TOKEN", () => {
      expect(
        isApifyEbaySoldEnabled({ COMPS_APIFY_EBAY_SOLD_ENABLED: "true", APIFY_TOKEN: "t" }),
      ).toBe(true);
      expect(isApifyEbaySoldEnabled({ COMPS_APIFY_EBAY_SOLD_ENABLED: "true" })).toBe(false);
      expect(isApifyEbaySoldEnabled({ APIFY_TOKEN: "t" })).toBe(false);
    });
    it("accepts the legacy PRICE_COMP_APIFY_EBAY_SOLD_ENABLED flag", () => {
      expect(
        isApifyEbaySoldEnabled({ PRICE_COMP_APIFY_EBAY_SOLD_ENABLED: "true", APIFY_TOKEN: "t" }),
      ).toBe(true);
    });
  });

  describe("ebay active", () => {
    it("requires the enable flag and browse credentials", () => {
      expect(
        isEbayActiveEnabled({
          COMPS_EBAY_ACTIVE_ENABLED: "true",
          EBAY_BROWSE_CLIENT_ID: "id",
          EBAY_BROWSE_CLIENT_SECRET: "secret",
        }),
      ).toBe(true);
      expect(isEbayActiveEnabled({ COMPS_EBAY_ACTIVE_ENABLED: "true" })).toBe(false);
    });
    it("accepts shared EBAY_CLIENT_ID/SECRET as credentials", () => {
      expect(
        isEbayActiveEnabled({
          COMPS_EBAY_ACTIVE_ENABLED: "true",
          EBAY_CLIENT_ID: "id",
          EBAY_CLIENT_SECRET: "secret",
        }),
      ).toBe(true);
    });
    it("accepts the legacy PRICE_COMP_EBAY_SEARCH_ENABLED flag", () => {
      expect(
        isEbayActiveEnabled({
          PRICE_COMP_EBAY_SEARCH_ENABLED: "true",
          EBAY_CLIENT_ID: "id",
          EBAY_CLIENT_SECRET: "secret",
        }),
      ).toBe(true);
    });
  });

  describe("serpapi ebay active (optional)", () => {
    it("requires the flag and SERPAPI_API_KEY, off by default", () => {
      expect(isSerpapiEbayActiveEnabled({})).toBe(false);
      expect(
        isSerpapiEbayActiveEnabled({ COMPS_SERPAPI_EBAY_ACTIVE_ENABLED: "true", SERPAPI_API_KEY: "k" }),
      ).toBe(true);
      expect(isSerpapiEbayActiveEnabled({ COMPS_SERPAPI_EBAY_ACTIVE_ENABLED: "true" })).toBe(false);
    });
  });

  describe("cost and identity controls", () => {
    it("uses conservative defaults", () => {
      expect(compsMaxProviderResults({})).toBe(20);
      expect(compsMaxQueryVariants({})).toBe(2);
      expect(compsAutoMinIdentityConfidence({})).toBe(0.55);
    });

    it("clamps provider and query caps", () => {
      expect(compsMaxProviderResults({ COMPS_MAX_PROVIDER_RESULTS: "999" })).toBe(30);
      expect(compsMaxProviderResults({ COMPS_MAX_PROVIDER_RESULTS: "0" })).toBe(1);
      expect(compsMaxQueryVariants({ COMPS_MAX_QUERY_VARIANTS: "999" })).toBe(3);
      expect(compsMaxQueryVariants({ COMPS_MAX_QUERY_VARIANTS: "0" })).toBe(1);
    });

    it("falls back for invalid values and clamps identity confidence", () => {
      expect(compsMaxProviderResults({ COMPS_MAX_PROVIDER_RESULTS: "many" })).toBe(20);
      expect(compsMaxQueryVariants({ COMPS_MAX_QUERY_VARIANTS: "many" })).toBe(2);
      expect(compsAutoMinIdentityConfidence({ COMPS_AUTO_MIN_IDENTITY_CONFIDENCE: "2" })).toBe(1);
      expect(compsAutoMinIdentityConfidence({ COMPS_AUTO_MIN_IDENTITY_CONFIDENCE: "-1" })).toBe(0);
      expect(compsAutoMinIdentityConfidence({ COMPS_AUTO_MIN_IDENTITY_CONFIDENCE: "nope" })).toBe(0.55);
    });
  });
});
