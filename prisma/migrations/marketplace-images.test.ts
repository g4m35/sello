import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("marketplace image migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260617120000_add_marketplace_images/migration.sql",
    ),
    "utf8",
  );

  it("adds additive derivative image persistence", () => {
    expect(sql).toContain(`CREATE TABLE "MarketplaceImage"`);
    expect(sql).toContain(`"itemPhotoId" UUID NOT NULL`);
    expect(sql).toContain(`"publicUrl" TEXT NOT NULL`);
    expect(sql).toContain(`"MarketplaceImageStatus"`);
  });

  it("reuses one derivative per source photo, marketplace, and environment", () => {
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "MarketplaceImage_itemPhotoId_marketplace_environment_key"`,
    );
    expect(sql).toContain(`"itemPhotoId", "marketplace", "environment"`);
  });

  it("cascades with item/photo ownership and enables RLS", () => {
    expect(sql).toContain(`REFERENCES "InventoryItem"("id")`);
    expect(sql).toContain(`REFERENCES "ItemPhoto"("id")`);
    expect(sql).toContain(`ON DELETE CASCADE`);
    expect(sql).toContain(`ALTER TABLE "MarketplaceImage" ENABLE ROW LEVEL SECURITY`);
  });
});
