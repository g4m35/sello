import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("bulk intake migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260710010000_add_bulk_intake/migration.sql"),
    "utf8",
  );

  it("creates the durable batch, item, and photo tables with exact status enums", () => {
    expect(sql).toContain(`CREATE TABLE "BulkBatch"`);
    expect(sql).toContain(`CREATE TABLE "BulkItem"`);
    expect(sql).toContain(`CREATE TABLE "BulkPhoto"`);
    for (const status of [
      "created",
      "uploading",
      "processing",
      "needs_review",
      "ready",
      "partially_failed",
      "failed",
      "canceled",
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
    for (const status of [
      "uploaded",
      "grouping",
      "ready_for_generation",
      "generating",
      "listing_ready",
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it("enforces account idempotency, photo order, and one conversion per item", () => {
    expect(sql).toContain(`BulkBatch_accountId_idempotencyKey_key`);
    expect(sql).toContain(`BulkPhoto_batchId_position_key`);
    expect(sql).toContain(`BulkItem_inventoryItemId_key`);
  });

  it("cascades owned rows and keeps the deny-all RLS posture", () => {
    expect(sql).toContain(`BulkBatch_accountId_fkey`);
    expect(sql).toContain(`REFERENCES "Account"("id") ON DELETE CASCADE`);
    expect(sql).toContain(`BulkPhoto_bulkItemId_fkey`);
    for (const table of ["BulkBatch", "BulkItem", "BulkPhoto"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    }
    expect(sql).not.toContain("CREATE POLICY");
  });
});
