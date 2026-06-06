import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("eBay token/config RLS migration", () => {
  it("adds a corrective migration for Supabase eBay advisor findings", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql",
      ),
      "utf8",
    );

    expect(sql).toContain('ALTER POLICY "MarketplaceConnection_user_select"');
    expect(sql).toContain('ALTER POLICY "EbaySellerConfig_user_select"');
    expect(sql).toContain('"userId" = (select auth.uid())');
    expect(sql).not.toMatch(/"userId"\s*=\s*auth\.(?:uid|jwt|role|email)\(/);
    expect(sql).toContain(
      'CREATE INDEX "EbaySellerConfig_marketplaceConnectionId_idx"\n' +
        '    ON "EbaySellerConfig"("marketplaceConnectionId");',
    );
  });
});
