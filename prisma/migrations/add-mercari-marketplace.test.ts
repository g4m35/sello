import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("mercari marketplace migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260717000000_add_mercari_marketplace/migration.sql",
    ),
    "utf8",
  );

  it("adds the enum value additively and idempotently", () => {
    expect(sql).toContain(
      `ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'mercari'`,
    );
  });

  it("touches nothing beyond the enum (no tables, no data rewrites)", () => {
    expect(sql).not.toMatch(/CREATE TABLE|DROP|UPDATE|DELETE|INSERT/i);
  });
});
