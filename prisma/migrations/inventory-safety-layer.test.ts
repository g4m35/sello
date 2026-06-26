import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("inventory safety layer migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260626000000_inventory_safety_layer/migration.sql",
    ),
    "utf8",
  );

  const newTables = [
    "InventoryEvent",
    "ReviewTask",
    "SyncJob",
    "EmailSignal",
    "Notification",
  ] as const;

  it("creates the 5 new safety tables", () => {
    for (const table of newTables) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("enables RLS on each of the 5 new tables", () => {
    for (const table of newTables) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("creates the new safety enums", () => {
    expect(sql).toContain(`CREATE TYPE "InventoryEventType"`);
    expect(sql).toContain(`CREATE TYPE "SignalSource"`);
    expect(sql).toContain(`CREATE TYPE "ReviewTaskType"`);
    expect(sql).toContain(`CREATE TYPE "ReviewTaskStatus"`);
    expect(sql).toContain(`CREATE TYPE "SyncJobType"`);
    expect(sql).toContain(`CREATE TYPE "SyncJobStatus"`);
    expect(sql).toContain(`CREATE TYPE "EmailSignalType"`);
  });

  it("makes SyncJob.idempotencyKey a FULL unique (idempotent enqueue)", () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "SyncJob_idempotencyKey_key"`);
  });

  it("adds the source-of-truth safety columns to InventoryItem", () => {
    expect(sql).toContain(`ADD COLUMN "quantityAvailable" INTEGER NOT NULL DEFAULT 1`);
    expect(sql).toContain(`ADD COLUMN "soldSourceMarketplace" "Marketplace"`);
    expect(sql).toContain(`ADD COLUMN "soldSourceListingId" TEXT`);
    expect(sql).toContain(`ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 0`);
  });

  it("adds the registry/url/snapshot columns to MarketplaceListing", () => {
    expect(sql).toContain(`ADD COLUMN "externalUrl" TEXT`);
    expect(sql).toContain(`ADD COLUMN "titleSnapshot" TEXT`);
    expect(sql).toContain(`ADD COLUMN "skuSnapshot" TEXT`);
    expect(sql).toContain(`ADD COLUMN "metadata" JSONB`);
    expect(sql).toContain(`ADD COLUMN "endedAt" TIMESTAMP(3)`);
  });

  it("adds the new MarketplaceListingStatus variants additively", () => {
    for (const value of [
      "ENDED",
      "UNKNOWN",
      "NEEDS_REVIEW",
      "SUBMITTED_FOR_AUDIT",
      "REJECTED",
    ]) {
      expect(sql).toContain(
        `ALTER TYPE "MarketplaceListingStatus" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  });
});
