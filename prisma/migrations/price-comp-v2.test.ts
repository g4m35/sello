import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(migrationsDir, "20260613020000_price_comp_v2_fields", "migration.sql"),
  "utf8",
);

describe("price_comp_v2 migration", () => {
  it("creates the two new enums", () => {
    expect(sql).toContain(`CREATE TYPE "CompSourceType"`);
    expect(sql).toContain(`CREATE TYPE "CompStatus"`);
  });

  it("adds every new PriceComp column", () => {
    for (const col of [
      "sourceType",
      "platform",
      "status",
      "brand",
      "size",
      "currency",
      "totalPriceCents",
      "imageUrl",
      "matchScore",
      "usedInPricing",
      "ignoredAsOutlier",
      "rawJson",
    ]) {
      expect(sql, `missing column ${col}`).toContain(`"${col}"`);
    }
  });

  it("is additive and non-destructive", () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/RENAME/i);
    // Keeps the table named PriceComp.
    expect(sql).toContain(`ALTER TABLE "PriceComp"`);
  });
});
