import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("20260701010000_stockx_foundation migration", () => {
  it("adds only additive StockX draft metadata fields", () => {
    const sql = readFileSync(join(__dirname, "migration.sql"), "utf8");
    expect(sql).toContain('ALTER TABLE "ListingDraft"');
    expect(sql).toContain('"stockxProductId"');
    expect(sql).toContain('"stockxVariantId"');
    expect(sql).toContain('"stockxMatchConfidence"');
    expect(sql).toContain('CREATE INDEX "ListingDraft_stockxProductId_idx"');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});
