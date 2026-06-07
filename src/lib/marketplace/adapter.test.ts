import { describe, expect, it } from "vitest";

import {
  getMarketplaceAdapter,
  listMarketplaceAdapters,
} from "./adapter";

describe("marketplace adapters (scaffolding only)", () => {
  it("registers exactly the four supported marketplaces", () => {
    const marketplaces = listMarketplaceAdapters()
      .map((adapter) => adapter.marketplace)
      .sort();

    expect(marketplaces).toEqual(["depop", "ebay", "grailed", "poshmark"]);
  });

  it("advertises draft preview but not publish or sync yet", () => {
    for (const adapter of listMarketplaceAdapters()) {
      expect(adapter.capabilities.draftPreview).toBe(true);
      expect(adapter.capabilities.publish).toBe(false);
      expect(adapter.capabilities.inventorySync).toBe(false);
      expect(adapter.displayName.length).toBeGreaterThan(0);
    }
  });

  it("returns a typed NOT_IMPLEMENTED outcome and never fakes success", async () => {
    const adapter = getMarketplaceAdapter("ebay");
    const outcome = await adapter.publishDraft({ inventoryItemId: "item-1" });

    expect(outcome.status).toBe("not_implemented");
    expect(outcome.code).toBe("NOT_IMPLEMENTED");
    expect(outcome.marketplace).toBe("ebay");
    expect(outcome.reason.length).toBeGreaterThan(0);
    expect("ok" in outcome).toBe(false);
  });
});
