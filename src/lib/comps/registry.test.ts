import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { COMP_SOURCES, enabledCompSources } from "./registry";

afterEach(() => vi.unstubAllEnvs());
describe("implemented comp provider availability", () => {
  it("does not advertise TODO providers even when their flags and credentials exist", () => {
    for (const key of ["PRICE_COMP_EBAY_MARKETPLACE_INSIGHTS_ENABLED", "EBAY_MARKETPLACE_INSIGHTS_ACCESS_APPROVED", "PRICE_COMP_GRAILED_SOLD_ENABLED", "PRICE_COMP_POSHMARK_SOLD_ENABLED", "PRICE_COMP_DEPOP_ACTIVE_ENABLED", "PRICE_COMP_GOOGLE_LENS_ENABLED"]) vi.stubEnv(key, "true");
    for (const key of ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "GRAILED_COMPS_API_KEY", "POSHMARK_COMPS_API_KEY", "DEPOP_COMPS_API_KEY", "GOOGLE_LENS_API_KEY"]) vi.stubEnv(key, "configured");
    const unimplemented = ["ebay-marketplace-insights", "grailed-sold", "poshmark-sold", "depop-active", "google-lens"];
    expect(COMP_SOURCES.map((source) => source.id).filter((id) => unimplemented.includes(id))).toEqual([]);
    expect(enabledCompSources().map((source) => source.id).filter((id) => unimplemented.includes(id))).toEqual([]);
  });
  it("retains the implemented sold provider behind its existing configuration gate", () => {
    vi.stubEnv("COMPS_APIFY_EBAY_SOLD_ENABLED", "true"); vi.stubEnv("APIFY_TOKEN", "configured");
    expect(enabledCompSources().some((source) => source.id === "apify-ebay-sold")).toBe(true);
    vi.stubEnv("COMPS_APIFY_EBAY_SOLD_ENABLED", "false"); vi.stubEnv("PRICE_COMP_APIFY_EBAY_SOLD_ENABLED", "false");
    expect(enabledCompSources().some((source) => source.id === "apify-ebay-sold")).toBe(false);
  });
});
