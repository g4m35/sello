import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("recovered app-table RLS migration provenance", () => {
  it("matches the checksum already recorded in the production Prisma ledger", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260709000000_enable_app_table_rls/migration.sql",
      ),
    );

    expect(migration.byteLength).toBe(6_820);
    expect(createHash("sha256").update(migration).digest("hex")).toBe(
      "be74518339e786761816721db2b3aaabffb8d4801024bc6dcc4c5cb0e6a1c10b",
    );
  });
});
