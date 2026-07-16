import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("public Data API deny-all migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260715200000_deny_public_data_api_access/migration.sql",
    ),
    "utf8",
  );

  it("drops public policies and revokes current and future Data API privileges", () => {
    expect(sql).toContain("FROM pg_policies");
    expect(sql).toContain("WHERE schemaname = 'public'");
    expect(sql).toContain("DROP POLICY IF EXISTS");
    expect(sql).toContain(
      "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;",
    );
    expect(sql).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA public");
  });

  it("does not disable RLS, mutate application rows, or affect Storage schemas", () => {
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(sql).not.toContain("storage.");
    expect(sql).not.toContain("auth.");
  });
});
