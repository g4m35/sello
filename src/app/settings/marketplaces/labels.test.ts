import { describe, expect, it } from "vitest";

import { ebayMarketplaceLabels } from "./labels";

describe("ebayMarketplaceLabels", () => {
  it("never says sandbox in production mode", () => {
    const labels = ebayMarketplaceLabels("production");

    expect(labels.account).toBe("Production account");
    expect(labels.connect).toBe("Connect eBay");
    expect(labels.heading).toBe("eBay");
    for (const value of Object.values(labels)) {
      expect(value.toLowerCase()).not.toContain("sandbox");
    }
  });

  it("keeps sandbox wording in sandbox mode", () => {
    const labels = ebayMarketplaceLabels("sandbox");

    expect(labels.heading).toBe("eBay Sandbox");
    expect(labels.account).toBe("Sandbox account");
    expect(labels.connect).toBe("Connect eBay Sandbox");
  });

  it("stays neutral while the environment is unknown", () => {
    const labels = ebayMarketplaceLabels(null);

    expect(labels.connect).toBe("Connect eBay");
    for (const value of Object.values(labels)) {
      expect(value.toLowerCase()).not.toContain("sandbox");
      expect(value.toLowerCase()).not.toContain("production");
    }
  });
});
