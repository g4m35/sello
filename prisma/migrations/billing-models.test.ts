import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("billing models migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260625010000_add_billing_models/migration.sql"),
    "utf8",
  );

  it("creates the five billing tables", () => {
    expect(sql).toContain(`CREATE TABLE "Account"`);
    expect(sql).toContain(`CREATE TABLE "AccountMember"`);
    expect(sql).toContain(`CREATE TABLE "Subscription"`);
    expect(sql).toContain(`CREATE TABLE "UsageCounter"`);
    expect(sql).toContain(`CREATE TABLE "StripeEvent"`);
  });

  it("creates the billing enums", () => {
    expect(sql).toContain(`CREATE TYPE "PlanTier" AS ENUM ('free', 'pro', 'kingpin')`);
    expect(sql).toContain(`CREATE TYPE "UsageMetric" AS ENUM`);
    expect(sql).toContain(`CREATE TYPE "SubscriptionStatus" AS ENUM`);
  });

  it("enforces the uniqueness the app relies on", () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "Account_ownerUserId_key"`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "Subscription_accountId_key"`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key"`);
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "UsageCounter_accountId_metric_periodStart_key"`,
    );
    expect(sql).toContain(`CREATE UNIQUE INDEX "AccountMember_accountId_userId_key"`);
  });

  it("cascades members, subscription, and usage from their account", () => {
    expect(sql).toContain(
      `ALTER TABLE "AccountMember" ADD CONSTRAINT "AccountMember_accountId_fkey"`,
    );
    expect(sql).toContain(`REFERENCES "Account"("id") ON DELETE CASCADE`);
  });

  it("keeps the uniform deny-all RLS posture (enable, no policy)", () => {
    for (const table of ["Account", "AccountMember", "Subscription", "UsageCounter", "StripeEvent"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    }
    expect(sql).not.toContain("CREATE POLICY");
  });
});
