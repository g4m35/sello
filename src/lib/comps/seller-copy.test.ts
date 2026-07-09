import { describe, expect, it } from "vitest";

import {
  buildPricingNotes,
  friendlySourceLabels,
  sellerSafeSourceErrors,
} from "./seller-copy";

describe("friendlySourceLabels", () => {
  it("collapses raw provider ids into seller-friendly categories", () => {
    const labels = friendlySourceLabels([
      "apify-ebay-sold",
      "grailed-sold",
      "ebay-browse",
      "serpapi-ebay-active",
      "google-lens",
    ]);
    expect(labels).toContain("Fresh sold comps");
    expect(labels).toContain("Active market listings");
    expect(labels).toContain("Visual match search");
  });

  it("dedupes and never exposes raw provider ids", () => {
    const labels = friendlySourceLabels(["apify-ebay-sold", "poshmark-sold", "stockx"]);
    expect(labels).toEqual(["Fresh sold comps"]);
    expect(labels.join(" ")).not.toMatch(/apify|stockx|poshmark/i);
  });

  it("returns an empty list when no sources are enabled", () => {
    expect(friendlySourceLabels([])).toEqual([]);
  });
});

describe("buildPricingNotes", () => {
  it("explains disabled fresh sold comps and keeps manual comps", () => {
    const notes = buildPricingNotes({
      autoDiscoveryEnabled: true,
      paidProvidersEnabled: false,
      status: "found_comps",
      sourceErrors: [],
    });
    expect(notes.some((n) => /disabled right now/i.test(n))).toBe(true);
    expect(notes.some((n) => /manual comps/i.test(n))).toBe(true);
  });

  it("points sellers to manual refresh when background discovery is off", () => {
    const notes = buildPricingNotes({
      autoDiscoveryEnabled: false,
      paidProvidersEnabled: true,
      status: "disabled",
      sourceErrors: [],
    });
    expect(notes).toEqual([
      "Automatic background pricing is off. Use Refresh comps to search fresh sold comps for this listing.",
    ]);
  });

  it("explains weak identity with what to improve", () => {
    const notes = buildPricingNotes({
      autoDiscoveryEnabled: true,
      paidProvidersEnabled: true,
      status: "skipped_weak_identity",
      sourceErrors: [
        { source: "sello", message: "Automatic comps skipped until item identity is specific enough." },
      ],
    });
    expect(notes.some((n) => /brand|product name|model/i.test(n))).toBe(true);
  });

  it("maps budget, quota, cooldown and provider errors to safe copy", () => {
    const notes = buildPricingNotes({
      autoDiscoveryEnabled: true,
      paidProvidersEnabled: true,
      status: "found_comps",
      sourceErrors: [
        { source: "apify-ebay-sold", message: "Paid comp providers skipped: global_budget_exceeded" },
        { source: "apify-ebay-sold", message: "Paid comp providers skipped: user_daily_quota_exceeded" },
        { source: "apify-ebay-sold", message: "Paid comp provider failed. Try again later." },
        { source: "stockx", message: "marketplace_not_connected" },
      ],
    });
    const joined = notes.join(" | ");
    expect(joined).not.toMatch(/apify|global_budget_exceeded|user_daily_quota_exceeded|marketplace_not_connected/i);
    expect(joined).toMatch(/Connect StockX/i);
    expect(joined).toMatch(/temporarily unavailable/i);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("never leaks raw skip reason codes or provider ids", () => {
    const notes = buildPricingNotes({
      autoDiscoveryEnabled: false,
      paidProvidersEnabled: false,
      status: "disabled",
      sourceErrors: [{ source: "apify-ebay-sold", message: "paid_providers_disabled" }],
    });
    expect(notes.join(" ")).not.toMatch(/apify-ebay-sold|paid_providers_disabled/);
    expect(notes.join(" ")).toMatch(/disabled right now/i);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("sellerSafeSourceErrors", () => {
  it("replaces provider ids and internal errors with seller-safe copy", () => {
    const errors = sellerSafeSourceErrors([
      {
        source: "apify-ebay-sold",
        message: "Paid comp providers skipped: global_budget_exceeded",
      },
      {
        source: "google-lens",
        message: "upstream token secret-provider-token failed",
      },
    ]);
    const serialized = JSON.stringify(errors);

    expect(errors).toEqual([
      {
        source: "Fresh sold comps",
        message: "Fresh sold comps are paused for now (daily limit reached). Manual comps still work.",
      },
      {
        source: "Visual match search",
        message: "A pricing source was temporarily unavailable. Try again later.",
      },
    ]);
    expect(serialized).not.toMatch(/apify|google-lens|global_budget_exceeded|secret-provider-token/i);
  });
});
