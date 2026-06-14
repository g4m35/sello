import { describe, expect, it } from "vitest";

import { getAutoCompStatusCopy } from "@/lib/comps/status";

describe("getAutoCompStatusCopy", () => {
  it("distinguishes disabled auto discovery from missing manual comps", () => {
    const copy = getAutoCompStatusCopy(
      { status: "disabled", autoDiscoveryEnabled: false, enabledSources: [] },
      { validComps: 0, confidence: "none" },
    );
    expect(copy.title).toBe("Auto comps are disabled");
    expect(copy.desc).toContain("Manual comps are available");
  });

  it("distinguishes source-unavailable from no comps found", () => {
    const unavailable = getAutoCompStatusCopy(
      { status: "source_unavailable", autoDiscoveryEnabled: true, enabledSources: [] },
      { validComps: 0, confidence: "none" },
    );
    expect(unavailable.title).toBe("No automatic comp source is connected");

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
});
