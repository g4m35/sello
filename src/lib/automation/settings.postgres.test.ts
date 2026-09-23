import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function binary(name: string) {
  try { return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const initdb = binary("initdb");
const pgctl = binary("pg_ctl");
const psql = binary("psql");
// No application database is touched. This local integration check uses an
// isolated PostgreSQL cluster and explicitly skips hosts without PostgreSQL.
describe.skipIf(!initdb || !pgctl || !psql || process.getuid?.() === 0)("nullable account policy migration in isolated PostgreSQL", () => {
  let directory: string;
  let data: string;
  let started = false;
  const port = 15433;
  const sql = (statement: string) => execFileSync(psql!, ["-h", directory, "-p", String(port), "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "sello-policy-pg-"));
    data = join(directory, "data");
    execFileSync(initdb!, ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
    execFileSync(pgctl!, ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-F -k ${directory} -p ${port} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    sql(`CREATE TABLE "Account" (id uuid PRIMARY KEY, "ownerUserId" uuid NOT NULL); ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY; INSERT INTO "Account" VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')`);
    sql(readFileSync("prisma/migrations/20260923080000_account_automation_policy/migration.sql", "utf8"));
  }, 30_000);
  afterAll(() => {
    try { if (started) execFileSync(pgctl!, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" }); }
    finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
  });
  it("keeps existing accounts disabled and RLS enabled", () => {
    expect(sql('SELECT "automationPolicy" IS NULL FROM "Account"').trim()).toBe("t");
    expect(sql(`SELECT relrowsecurity FROM pg_class WHERE relname = 'Account'`).trim()).toBe("t");
  });
  it("stores bounded authorization JSON without backfilling other accounts", () => {
    sql(`UPDATE "Account" SET "automationPolicy" = '{"version":1,"enabled":true,"minPriceCents":1000,"maxPriceCents":50000}'::jsonb`);
    expect(sql(`SELECT "automationPolicy"->>'enabled' FROM "Account"`).trim()).toBe("true");
    sql(`INSERT INTO "Account" (id, "ownerUserId") VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004')`);
    expect(sql('SELECT count(*) FROM "Account" WHERE "automationPolicy" IS NULL').trim()).toBe("1");
  });
});
