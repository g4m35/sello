import { describe, expect, it } from "vitest";

import {
  enqueueSyncJob,
  markSyncJobFailed,
  markSyncJobSucceeded,
  type SyncJobPrismaLike,
  type SyncJobRow,
} from "./sync-jobs";

type FakeJob = SyncJobRow & {
  userId: string;
  errorCode: string | null;
  errorMessage: string | null;
};

function createFakePrisma(): SyncJobPrismaLike & { _jobs: FakeJob[] } {
  const jobs: FakeJob[] = [];
  return {
    _jobs: jobs,
    syncJob: {
      async upsert({ where, create }) {
        const existing = jobs.find((j) => j.idempotencyKey === where.idempotencyKey);
        if (existing) {
          // ON CONFLICT DO NOTHING: existing row wins unchanged.
          return {
            id: existing.id,
            type: existing.type,
            status: existing.status,
            idempotencyKey: existing.idempotencyKey,
            attempts: existing.attempts,
          };
        }
        const job: FakeJob = {
          id: `job-${jobs.length + 1}`,
          type: create.type,
          status: create.status,
          idempotencyKey: create.idempotencyKey,
          attempts: 0,
          userId: create.userId,
          errorCode: null,
          errorMessage: null,
        };
        jobs.push(job);
        return {
          id: job.id,
          type: job.type,
          status: job.status,
          idempotencyKey: job.idempotencyKey,
          attempts: job.attempts,
        };
      },
      async update({ where, data }) {
        const job = jobs.find((j) => j.id === where.id);
        if (!job) throw new Error("job not found");
        if (data.status) job.status = data.status;
        if (data.attempts) job.attempts += data.attempts.increment;
        if ("errorCode" in data) job.errorCode = data.errorCode ?? null;
        if ("errorMessage" in data) job.errorMessage = data.errorMessage ?? null;
        return { id: job.id };
      },
    },
  };
}

describe("enqueueSyncJob", () => {
  it("creates a queued job on first enqueue", async () => {
    const prisma = createFakePrisma();

    const job = await enqueueSyncJob(prisma, {
      userId: "user-1",
      accountId: "account-1",
      type: "delist_marketplace_listing",
      idempotencyKey: "delist:item-1:listing-1",
      payload: { foo: "bar" },
    });

    expect(job.status).toBe("queued");
    expect(prisma._jobs).toHaveLength(1);
  });

  it("is idempotent: re-enqueuing the same key returns the existing row and creates no duplicate", async () => {
    const prisma = createFakePrisma();
    const input = {
      userId: "user-1",
      accountId: "account-1",
      type: "delist_marketplace_listing" as const,
      idempotencyKey: "delist:item-1:listing-1",
    };

    const first = await enqueueSyncJob(prisma, input);
    const second = await enqueueSyncJob(prisma, input);

    expect(second.id).toBe(first.id);
    expect(prisma._jobs).toHaveLength(1);
  });

  it("honors an explicit needs_review status for channels with no adapter", async () => {
    const prisma = createFakePrisma();

    const job = await enqueueSyncJob(prisma, {
      userId: "user-1",
      accountId: "account-1",
      type: "delist_marketplace_listing",
      idempotencyKey: "delist:item-1:listing-2",
      status: "needs_review",
    });

    expect(job.status).toBe("needs_review");
  });
});

describe("markSyncJob* helpers", () => {
  it("marks succeeded, bumps attempts, clears error", async () => {
    const prisma = createFakePrisma();
    const job = await enqueueSyncJob(prisma, {
      userId: "user-1",
      accountId: "account-1",
      type: "delist_marketplace_listing",
      idempotencyKey: "k1",
    });

    await markSyncJobSucceeded(prisma, job.id);

    expect(prisma._jobs[0].status).toBe("succeeded");
    expect(prisma._jobs[0].attempts).toBe(1);
    expect(prisma._jobs[0].errorMessage).toBeNull();
  });

  it("marks failed with a sanitized error message (no raw provider text)", async () => {
    const prisma = createFakePrisma();
    const job = await enqueueSyncJob(prisma, {
      userId: "user-1",
      accountId: "account-1",
      type: "delist_marketplace_listing",
      idempotencyKey: "k2",
    });

    await markSyncJobFailed(prisma, job.id, {
      code: "DELIST_FAILED",
      error: new Error(
        'provider blew up: {"errors":[{"message":"Authorization: Bearer secret.token"}]}',
      ),
    });

    expect(prisma._jobs[0].status).toBe("failed");
    expect(prisma._jobs[0].attempts).toBe(1);
    expect(prisma._jobs[0].errorCode).toBe("DELIST_FAILED");
    // Raw JSON / Bearer token scrubbed to the safe fallback.
    expect(prisma._jobs[0].errorMessage).toBe("The sync job failed.");
    expect(JSON.stringify(prisma._jobs[0])).not.toContain("Bearer");
    expect(JSON.stringify(prisma._jobs[0])).not.toContain("secret.token");
  });
});
