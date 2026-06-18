import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Feedback migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260618130000_add_feedback/migration.sql"),
    "utf8",
  );

  it("creates an additive feedback table + enums", () => {
    expect(sql).toContain(`CREATE TYPE "FeedbackType"`);
    expect(sql).toContain(`CREATE TYPE "FeedbackStatus"`);
    expect(sql).toContain(`CREATE TABLE "Feedback"`);
    expect(sql).toContain(`"userId" UUID NOT NULL`);
    expect(sql).not.toContain("ON DELETE CASCADE");
  });

  it("enables RLS for defense-in-depth", () => {
    expect(sql).toContain(`ENABLE ROW LEVEL SECURITY`);
  });
});
