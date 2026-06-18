import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ProviderCallLedger migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260618120000_add_provider_call_ledger/migration.sql",
    ),
    "utf8",
  );

  it("creates an additive ledger table with the cost/quota columns", () => {
    expect(sql).toContain(`CREATE TYPE "ProviderCallStatus"`);
    expect(sql).toContain(`CREATE TABLE "ProviderCallLedger"`);
    expect(sql).toContain(`"userId" UUID NOT NULL`);
    expect(sql).toContain(`"estimatedCostCents" INTEGER NOT NULL DEFAULT 0`);
    expect(sql).toContain(`"skippedReason" TEXT`);
    // Not cascaded: cost history must survive draft/item deletion.
    expect(sql).not.toContain("ON DELETE CASCADE");
  });

  it("indexes by user and enables RLS for defense-in-depth", () => {
    expect(sql).toContain(`"ProviderCallLedger_userId_createdAt_idx"`);
    expect(sql).toContain(`ENABLE ROW LEVEL SECURITY`);
  });
});
