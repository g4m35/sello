import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("paid-beta P0 readiness migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260711010000_paid_beta_p0_readiness/migration.sql",
    ),
    "utf8",
  );

  it("fails closed before enforcing cross-account bulk links", () => {
    expect(sql).toContain("BulkItem contains a cross-account or unscoped inventory link");
    expect(sql).toContain("BulkPhoto contains a cross-batch or cross-account item link");
    expect(sql).toContain('"BulkItem_batchId_accountId_fkey"');
    expect(sql).toContain('"BulkItem_inventoryItemId_accountId_fkey"');
    expect(sql).toContain(
      'REFERENCES "InventoryItem"("id", "accountId")\n  ON DELETE NO ACTION',
    );
    expect(sql).toContain('"BulkPhoto_batchId_accountId_fkey"');
    expect(sql).toContain('"BulkPhoto_item_ownership_trigger"');
    expect(sql).toContain('"BulkItem_populate_account_trigger"');
    expect(sql).toContain('"BulkPhoto_populate_account_trigger"');
  });

  it("adds durable atomic usage reservations and account provider idempotency", () => {
    expect(sql).toContain('CREATE TABLE "UsageReservation"');
    expect(sql).toContain('"UsageReservation_accountId_metric_idempotencyKey_key"');
    expect(sql).toContain('"UsageReservation_units_check"');
    expect(sql).toContain('"ProviderCallLedger_accountId_idempotencyKey_key"');
  });

  it("adds explicit worker retry, lease, cancellation, and account scope", () => {
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'retry_wait'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'canceled'");
    for (const column of ["accountId", "lockedAt", "leaseOwner", "retryClass", "completedAt"]) {
      expect(sql).toContain(`ALTER TABLE "SyncJob" ADD COLUMN "${column}"`);
    }
  });

  it("adds account-scoped sale-signal deduplication with deny-all RLS", () => {
    expect(sql).toContain('CREATE TABLE "MarketplaceSaleSignal"');
    expect(sql).toContain('"MarketplaceSaleSignal_account_marketplace_environment_event_key"');
    expect(sql).toContain('ALTER TABLE "MarketplaceSaleSignal" ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain("CREATE POLICY");
  });

  it("contains no destructive table or column operations", () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});
