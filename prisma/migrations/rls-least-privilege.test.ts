import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RLS least-privilege hardening migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260625000000_rls_least_privilege_hardening/migration.sql",
    ),
    "utf8",
  );

  it("enables RLS on CompSearchRun, the only table that lacked it", () => {
    expect(sql).toContain(
      'ALTER TABLE "CompSearchRun" ENABLE ROW LEVEL SECURITY;',
    );
  });

  it("drops every eBay authenticated policy for a uniform deny-all posture", () => {
    const policies = [
      "MarketplaceConnection_user_select",
      "MarketplaceConnection_user_insert",
      "MarketplaceConnection_user_update",
      "MarketplaceConnection_user_delete",
      "EbaySellerConfig_user_select",
      "EbaySellerConfig_user_insert",
      "EbaySellerConfig_user_update",
      "EbaySellerConfig_user_delete",
    ];
    for (const policy of policies) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${policy}"`);
    }
  });

  it("only adjusts RLS/policies: no new policy, no RLS disable, no data DML", () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
