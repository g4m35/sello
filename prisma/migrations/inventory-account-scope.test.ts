import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("inventory account-scope migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260625020000_inventory_account_scope/migration.sql"),
    "utf8",
  );

  it("backfills a personal account for every existing seller", () => {
    expect(sql).toContain(`INSERT INTO "Account"`);
    expect(sql).toContain(`SELECT DISTINCT "sellerId" FROM "InventoryItem"`);
    expect(sql).toContain(`INSERT INTO "AccountMember"`);
  });

  it("adds and backfills the accountId column", () => {
    expect(sql).toContain(`ALTER TABLE "InventoryItem" ADD COLUMN "accountId" UUID`);
    expect(sql).toContain(`UPDATE "InventoryItem"`);
    expect(sql).toContain(`a."ownerUserId" = i."sellerId"`);
  });

  it("indexes accountId and adds the foreign key", () => {
    expect(sql).toContain(`CREATE INDEX "InventoryItem_accountId_status_idx"`);
    expect(sql).toContain(`"InventoryItem_accountId_fkey"`);
    expect(sql).toContain(`ON DELETE SET NULL`);
  });

  it("does not touch RLS", () => {
    expect(sql).not.toContain("ROW LEVEL SECURITY");
    expect(sql).not.toContain("CREATE POLICY");
  });
});
