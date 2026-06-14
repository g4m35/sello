import { describe, expect, it } from "vitest";

import { SOLD_COMP_PROVIDER_OPTIONS } from "@/lib/comps/sold-source-strategy";

describe("SOLD_COMP_PROVIDER_OPTIONS", () => {
  it("keeps sold-comp automation restricted until an approved API/source exists", () => {
    expect(SOLD_COMP_PROVIDER_OPTIONS).toContainEqual(
      expect.objectContaining({
        id: "ebay-marketplace-insights",
        status: "restricted",
      }),
    );
    expect(SOLD_COMP_PROVIDER_OPTIONS).toContainEqual(
      expect.objectContaining({
        id: "manual-sold-comp",
        status: "manual_only",
      }),
    );
  });
});
