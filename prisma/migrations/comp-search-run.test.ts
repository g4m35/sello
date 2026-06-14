import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("comp search run migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260614120000_add_comp_search_runs/migration.sql"),
    "utf8",
  );

  it("creates additive search-run persistence for automatic comps", () => {
    expect(sql).toContain(`CREATE TABLE "CompSearchRun"`);
    expect(sql).toContain(`"queries" JSONB NOT NULL`);
    expect(sql).toContain(`"sourceErrors" JSONB NOT NULL`);
    expect(sql).toContain(`"sourcesChecked" TEXT[] NOT NULL`);
    expect(sql).toContain(`"recommendedPriceCents" INTEGER`);
  });

  it("cascades with the inventory item and indexes recent runs", () => {
    expect(sql).toContain(`REFERENCES "InventoryItem"("id")`);
    expect(sql).toContain(`ON DELETE CASCADE`);
    expect(sql).toContain(`"CompSearchRun_inventoryItemId_createdAt_idx"`);
  });

  it("does not modify PriceComp manual comp rows", () => {
    expect(sql).not.toMatch(/ALTER TABLE "PriceComp"/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
