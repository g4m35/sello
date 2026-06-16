import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("PublishAttempt active-idempotency unique index migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260616130000_add_publish_attempt_idempotency_unique/migration.sql",
    ),
    "utf8",
  );

  it("creates a partial unique index on (marketplaceListingId, idempotencyKey)", () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "PublishAttempt_active_idempotency_key"',
    );
    expect(sql).toContain(
      '"PublishAttempt" ("marketplaceListingId", "idempotencyKey")',
    );
  });

  it("scopes the index to active/successful attempts so failed retries stay allowed", () => {
    const where = sql.slice(sql.indexOf("WHERE"));
    expect(where).toContain("'QUEUED'");
    expect(where).toContain("'RUNNING'");
    expect(where).toContain("'SUCCEEDED'");
    // FAILED / NOT_IMPLEMENTED rows must be excluded so an item can be retried
    // after a failure and so non-eBay NOT_IMPLEMENTED attempts never collide.
    expect(where).not.toContain("'FAILED'");
    expect(where).not.toContain("'NOT_IMPLEMENTED'");
  });
});
