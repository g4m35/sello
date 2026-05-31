import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("eBay token/config RLS migration", () => {
  it("enables RLS and user-scoped policies on eBay connection tables", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260531000000_enable_ebay_connection_rls/migration.sql",
      ),
      "utf8",
    );

    expect(sql).toContain('ALTER TABLE "MarketplaceConnection" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "EbaySellerConfig" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('"userId" = auth.uid()');
    expect(sql).toContain('ON "MarketplaceConnection"');
    expect(sql).toContain('ON "EbaySellerConfig"');
  });
});
