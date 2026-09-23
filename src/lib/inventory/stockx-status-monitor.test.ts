import { describe, expect, it, vi } from "vitest";
import type { Prisma, SyncJobStatus } from "@/generated/prisma/client";
import { enqueueStockXStatusChecks, STOCKX_MONITOR_INTERVAL_MS, stockxMonitorKey } from "./stockx-status-monitor";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const candidate = (id = "listing-1") => ({ id, inventoryItemId: `item-${id}`, accountId: "account-1", userId: "connection-owner" });
type Candidate = ReturnType<typeof candidate>;
type Job = { id: string; type: "detect_status"; status: SyncJobStatus; idempotencyKey: string; attempts: number; accountId: string; marketplaceListingId: string; updatedAt: Date };
function fixture(candidates: Candidate[] = [candidate()]) {
  const jobs: Job[] = [];
  const locks = new Set<string>();
  let failEnqueueAt = Number.POSITIVE_INFINITY;
  let enqueueCalls = 0;
  const rawQueries: Prisma.Sql[] = [];
  const creates: unknown[] = [];
  const db = {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      const ownedLocks: string[] = [];
      const created: Job[] = [];
      const tx = {
        $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
          rawQueries.push(sql);
          // Fake row locks, not provider or production data. Selection predicate
          // correctness is separately asserted against the SQL contract below.
          return candidates.filter((row) => !locks.has(row.id)).slice(0, 25).map((row) => {
            locks.add(row.id);
            ownedLocks.push(row.id);
            return row;
          });
        }),
        syncJob: {
          findFirst: vi.fn(async (args: { where: { marketplaceListingId: string; accountId: string; status?: { in: string[] } } }) => {
            const matching = jobs.filter((j) => j.marketplaceListingId === args.where.marketplaceListingId && j.accountId === args.where.accountId);
            return args.where.status
              ? matching.find((j) => args.where.status!.in.includes(j.status)) ?? null
              : matching.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
          }),
          upsert: vi.fn(async (args: { where: { idempotencyKey: string }; update: object; create: Job }) => {
            if (++enqueueCalls === failEnqueueAt) throw new Error("database error containing private connection details");
            expect(args.update).toEqual({});
            const existing = jobs.find((j) => j.idempotencyKey === args.where.idempotencyKey);
            if (existing) return existing;
            creates.push(args.create);
            const job: Job = { ...args.create, id: `job-${jobs.length}`, attempts: 0, updatedAt: new Date(NOW) };
            jobs.push(job);
            created.push(job);
            return job;
          }),
        },
      };
      try { return await run(tx); }
      catch (error) { created.forEach((job) => jobs.splice(jobs.indexOf(job), 1)); throw error; }
      finally { ownedLocks.forEach((id) => locks.delete(id)); }
    }),
  };
  const typedDb = db as unknown as Parameters<typeof enqueueStockXStatusChecks>[0];
  const deps = { enabled: () => true, now: () => NOW };
  return { db, typedDb, jobs, creates, rawQueries, deps, setFailEnqueue: (at = 1) => { failEnqueueAt = at; } };
}
function priorJob(status: SyncJobStatus, overrides: Partial<Job> = {}): Job {
  return { id: "old", type: "detect_status", accountId: "account-1", marketplaceListingId: "listing-1", status,
    idempotencyKey: "old-key", attempts: 5, updatedAt: new Date(NOW - 10_000), ...overrides };
}

describe("enqueueStockXStatusChecks", () => {
  it("enqueues account-scoped status intent using the connected user, with no provider payload", async () => {
    const f = fixture();
    expect(await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000)).toEqual({ scheduled: 1, skipped: 0, disabled: false, deadlineReached: false });
    expect(f.creates).toEqual([expect.objectContaining({ userId: "connection-owner", accountId: "account-1", inventoryItemId: "item-listing-1", marketplaceListingId: "listing-1", type: "detect_status", status: "queued", payload: { source: "stockx-status-monitor-v1" }, idempotencyKey: stockxMonitorKey("listing-1", Math.floor(NOW / STOCKX_MONITOR_INTERVAL_MS)) })]);
  });

  it("keeps eligibility, unsupported states and parked exclusions inside a bounded locked SQL selection", async () => {
    const f = fixture([]);
    await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000);
    const query = f.rawQueries[0];
    const sql = query.sql.replace(/\s+/g, " ");
    expect(sql).toContain('c."accountId" = i."accountId"');
    expect(sql).toContain("l.marketplace = 'stockx' AND l.environment = ?");
    expect(sql).toContain("c.marketplace = 'stockx' AND c.environment = ?");
    expect(sql).toContain("l.status = 'LISTED'");
    expect(sql).toContain('NULLIF(BTRIM(l."externalListingId"), \'\') IS NOT NULL');
    expect(sql).toContain("i.status NOT IN ('SOLD', 'DELISTING', 'DELISTED', 'ARCHIVED')");
    expect(sql).toContain('i."quantityAvailable" > 0');
    expect(sql).toContain('l."lastSyncAt" <= ?');
    expect(sql).toContain("latest.status IS NULL OR latest.status = 'succeeded'");
    expect(sql).toContain("j.status IN ('queued', 'running', 'retry_wait', 'needs_review')");
    expect(sql).toContain('ORDER BY l."lastSyncAt" ASC NULLS FIRST, l."createdAt" ASC, l.id ASC LIMIT ? FOR UPDATE OF l SKIP LOCKED');
    expect(query.values).toEqual(["production", "production", new Date(NOW - STOCKX_MONITOR_INTERVAL_MS), "stockx-status-monitor-v1", String(Math.floor(NOW / STOCKX_MONITOR_INTERVAL_MS)), 25]);
  });

  it("does not access the database when disabled or the deadline has elapsed", async () => {
    const f = fixture();
    expect(await enqueueStockXStatusChecks(f.typedDb, { ...f.deps, enabled: () => false }, NOW + 10_000)).toMatchObject({ disabled: true, scheduled: 0 });
    expect(await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW)).toMatchObject({ deadlineReached: true, scheduled: 0 });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "retry_wait", "needs_review", "failed", "skipped", "canceled"] as const)("rechecks and preserves %s work after locking", async (status) => {
    const f = fixture();
    f.jobs.push(priorJob(status));
    const result = await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000);
    expect(result).toMatchObject({ scheduled: 0, skipped: 1 });
    expect(f.jobs).toEqual([priorJob(status)]);
  });

  it("does not treat an unrelated account's failed job as the listing's blocker", async () => {
    const f = fixture();
    f.jobs.push(priorJob("failed", { accountId: "other-account" }));
    expect(await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000)).toMatchObject({ scheduled: 1 });
  });

  it("resumes after explicit successful recovery without resetting the old failed history", async () => {
    const f = fixture();
    f.jobs.push(priorJob("failed"));
    f.jobs.push(priorJob("succeeded", { id: "recovered", idempotencyKey: "explicit-recovery", updatedAt: new Date(NOW - 1_000) }));
    expect(await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000)).toMatchObject({ scheduled: 1 });
    expect(f.jobs[0]).toMatchObject({ status: "failed", attempts: 5 });
  });

  it("still respects older pending review even if a newer successful check exists", async () => {
    const f = fixture();
    f.jobs.push(priorJob("needs_review"));
    f.jobs.push(priorJob("succeeded", { id: "new", updatedAt: new Date(NOW) }));
    expect(await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000)).toMatchObject({ scheduled: 0 });
  });

  it("concurrent calls and adjacent windows never create two pending checks", async () => {
    const f = fixture();
    await Promise.all([
      enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000),
      enqueueStockXStatusChecks(f.typedDb, { ...f.deps, now: () => NOW + STOCKX_MONITOR_INTERVAL_MS }, NOW + STOCKX_MONITOR_INTERVAL_MS + 10_000),
    ]);
    await enqueueStockXStatusChecks(f.typedDb, { ...f.deps, now: () => NOW + STOCKX_MONITOR_INTERVAL_MS }, NOW + STOCKX_MONITOR_INTERVAL_MS + 10_000);
    expect(f.jobs).toHaveLength(1);
  });

  it("does not reopen a completed check in the same window", async () => {
    const f = fixture();
    await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000);
    f.jobs[0].status = "succeeded";
    expect(await enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000)).toMatchObject({ scheduled: 0, skipped: 1 });
    expect(f.jobs).toHaveLength(1);
  });

  it("bounds the batch and stops enqueueing when its shared deadline expires", async () => {
    const f = fixture(Array.from({ length: 30 }, (_, i) => candidate(`listing-${i}`)));
    let calls = 0;
    const result = await enqueueStockXStatusChecks(f.typedDb, { ...f.deps, now: () => ++calls <= 2 ? NOW : NOW + 10_000 }, NOW + 5_000);
    expect(result).toMatchObject({ scheduled: 1, deadlineReached: true });
    expect(f.jobs).toHaveLength(1);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000, maxWait: 1_000 });
  });

  it("rolls back and surfaces a sanitized failure instead of healthy counts", async () => {
    const f = fixture([candidate(), candidate("listing-2")]);
    f.setFailEnqueue(2);
    await expect(enqueueStockXStatusChecks(f.typedDb, f.deps, NOW + 10_000)).rejects.toThrow("StockX sale checks could not be scheduled.");
    expect(f.jobs).toEqual([]);
  });
});
