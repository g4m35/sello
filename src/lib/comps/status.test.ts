import { describe, expect, it } from "vitest";

import { getAutoCompStatusCopy } from "@/lib/comps/status";

describe("getAutoCompStatusCopy", () => {
  it("describes disabled fresh sold comps without sounding broken", () => {
    const copy = getAutoCompStatusCopy(
      { status: "disabled", autoDiscoveryEnabled: false, enabledSources: [] },
      { validComps: 0, confidence: "none" },
    );
    expect(copy.title).toBe("Fresh sold comps are disabled");
    expect(copy.desc).toContain("Manual comps still work");
  });

  it("explains when paid sold comps are off but discovery is on", () => {
    const copy = getAutoCompStatusCopy(
      {
        status: "not_run",
        autoDiscoveryEnabled: true,
        paidProvidersEnabled: false,
        enabledSources: ["apify-ebay-sold"],
      },
      { validComps: 0, confidence: "none" },
    );
    expect(copy.title).toBe("Fresh sold comps are disabled");
    expect(copy.desc).toContain("Manual comps still work");
  });

  it("distinguishes source-unavailable from no comps found", () => {
    const unavailable = getAutoCompStatusCopy(
      { status: "source_unavailable", autoDiscoveryEnabled: true, enabledSources: [] },
      { validComps: 0, confidence: "none" },
    );
    expect(unavailable.title).toBe("No sold-comp source connected yet");

    const noneFound = getAutoCompStatusCopy(
      { status: "no_comps_found", autoDiscoveryEnabled: true, enabledSources: ["ebay-browse"] },
      { validComps: 0, confidence: "none" },
    );
    expect(noneFound.title).toBe("No automatic comps found");
  });

  it("marks low-confidence results as needing review instead of authoritative", () => {
    const copy = getAutoCompStatusCopy(
      { status: "needs_review", autoDiscoveryEnabled: true, enabledSources: ["ebay-browse"] },
      { validComps: 2, confidence: "low" },
    );
    expect(copy.title).toBe("Auto comps need review");
    expect(copy.desc).toContain("Review the range");
  });

  it("does not call medium confidence authoritative", () => {
    const copy = getAutoCompStatusCopy(
      { status: "found_comps", autoDiscoveryEnabled: true, enabledSources: ["apify-ebay-sold"] },
      { validComps: 20, confidence: "medium", soldCompCount: 20, activeCompCount: 0 },
    );
    expect(copy.title).toBe("Sold comps need review");
    expect(copy.desc).toContain("match quality");
  });

  it("does not label active-listing-only estimates as sold comps", () => {
    const copy = getAutoCompStatusCopy(
      { status: "found_comps", autoDiscoveryEnabled: true, enabledSources: ["ebay-browse"] },
      {
        validComps: 8,
        confidence: "medium",
        soldCompCount: 0,
        activeCompCount: 8,
        pricingBasis: "active_market_estimate",
      },
    );
    expect(copy.title).toBe("Market listing estimate ready");
    expect(copy.desc).toContain("active listings");
    expect(copy.title).not.toContain("Sold");
  });
});
