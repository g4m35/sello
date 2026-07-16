import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("account-scoped notification deduplication", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const createSql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260712012000_create_account_scoped_notification_dedupe/migration.sql",
    ),
    "utf8",
  );
  const dropSql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260712012100_drop_global_notification_dedupe/migration.sql",
    ),
    "utf8",
  );

  it("models the unique selector as accountId plus dedupeKey", () => {
    expect(schema).toContain(
      '@@unique([accountId, dedupeKey], map: "Notification_accountId_dedupeKey_key")',
    );
    expect(schema).not.toMatch(/dedupeKey\s+String\?\s+@unique/);
  });

  it("uses one nontransactional statement per ordered migration", () => {
    expect(createSql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "Notification_accountId_dedupeKey_key"',
    );
    expect(createSql).not.toContain('DROP INDEX CONCURRENTLY "Notification_dedupeKey_key"');
    expect(dropSql).toContain('DROP INDEX CONCURRENTLY "Notification_dedupeKey_key"');
    expect(dropSql).not.toContain("CREATE UNIQUE INDEX CONCURRENTLY");
    for (const sql of [createSql, dropSql]) {
      expect(sql.match(/;/g)).toHaveLength(1);
      expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT)\b\s*;/i);
    }
  });

  it("keeps every timestamped migration directory complete and unambiguous", () => {
    const migrationsRoot = join(process.cwd(), "prisma/migrations");
    const directories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name);
    const timestamps = directories.map((name) => name.slice(0, 14));

    expect(new Set(timestamps).size).toBe(timestamps.length);
    for (const directory of directories) {
      expect(existsSync(join(migrationsRoot, directory, "migration.sql"))).toBe(true);
    }
  });
});
