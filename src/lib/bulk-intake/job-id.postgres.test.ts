import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bulkJobId } from "./job-id";

function binary(name: string) {
  try { return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const initdb = binary("initdb");
const pgctl = binary("pg_ctl");
const psql = binary("psql");
// No application database is touched. This local integration check uses an
// isolated PostgreSQL cluster and explicitly skips hosts without PostgreSQL.
describe.skipIf(!initdb || !pgctl || !psql || process.getuid?.() === 0)("bulk job IDs in PostgreSQL UUID columns", () => {
  let directory: string;
  let data: string;
  let started = false;
  const port = 15432;
  const sql = (statement: string) => execFileSync(psql!, ["-h", directory, "-p", String(port), "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "sello-bulk-pg-"));
    data = join(directory, "data");
    execFileSync(initdb!, ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
    execFileSync(pgctl!, ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-F -k ${directory} -p ${port} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    sql('CREATE TABLE "JobLog" (id uuid PRIMARY KEY, "queueName" text NOT NULL, payload jsonb NOT NULL)');
  }, 30_000);
  afterAll(() => {
    try { if (started) execFileSync(pgctl!, ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" }); }
    finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
  });
  it("inserts both generated IDs and deduplicates the same attempt", () => {
    const itemId = "20000000-0000-4000-8000-000000000099";
    const identify = bulkJobId("identify", itemId, 2);
    const prepare = bulkJobId("prepare", itemId);
    sql(`INSERT INTO "JobLog" VALUES ('${identify}', 'bulk-generation-v1', '{}'), ('${prepare}', 'listing-automation-v1', '{}')`);
    sql(`INSERT INTO "JobLog" VALUES ('${identify}', 'bulk-generation-v1', '{}') ON CONFLICT (id) DO NOTHING`);
    expect(sql('SELECT count(*) FROM "JobLog"').trim()).toBe("2");
    expect(sql(`SELECT '${identify}'::uuid`).trim()).toBe(identify);
    expect(sql(`SELECT '${prepare}'::uuid`).trim()).toBe(prepare);
  });
  it("rejects the formerly used namespaced strings", () => {
    expect(() => sql("SELECT 'bulk-identify:item-1:0'::uuid")).toThrow();
  });
});
