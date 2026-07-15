import { randomUUID } from "node:crypto";

import type {
  InventoryStatus,
  Marketplace,
  MarketplaceListingStatus,
  Prisma,
  SyncJobStatus,
  SyncJobType,
} from "@/generated/prisma/client";
import { safeFailureText } from "@/lib/errors";
import {
  recordInventoryEvent,
  type InventoryEventPrismaLike,
} from "@/lib/inventory/events";
import {
  createNotification,
  delistFailedCopy,
  type NotificationPrismaLike,
} from "@/lib/inventory/notifications";
import {
  createReviewTask,
  type ReviewTaskPrismaLike,
} from "@/lib/inventory/review-tasks";
import {
  executeEbayDelist,
  type DelistPrismaLike as MarketplaceDelistHandlerPrismaLike,
  executeStockXDelist,
} from "@/lib/marketplace/delist-handler";
import {
  syncStockXListingStatus,
  type StockXStatusSyncPrismaLike,
} from "@/lib/marketplace/adapters/stockx/status-sync";
import { getPrisma } from "@/lib/prisma";

// Worker/executor half of the inventory safety layer. The engine (mark-sold,
// delist, sale-signal) only RECORDS intent as durable SyncJobs; this module
// CLAIMS those jobs and EXECUTES them. It is pure and db-injectable like the
// engine (default getPrisma()) so the whole thing is unit-testable with the
// in-memory fake. Live delists go exclusively through the existing,
// ownership-scoped eBay and StockX handlers (never reimplemented). No secrets
// are logged; every error is scrubbed via safeFailureText before it is persisted
// to a job/event/task.

// --- Defaults ----------------------------------------------------------------

const DEFAULT_CLAIM_LIMIT = 10;
const MAX_CLAIM_LIMIT = 25;

// Stale-running reaper defaults. A 'running' job is "stale" once its updatedAt is
// older than this; bounded to a sane window so a clock skew or a misconfigured
// caller can never requeue/fail an enormous backlog at once.
const DEFAULT_STALE_MINUTES = 15;
const MIN_STALE_MINUTES = 5;
const MAX_STALE_MINUTES = 1440;

const MAX_ATTEMPTS_EXHAUSTED_MESSAGE =
  "The job exceeded its maximum attempts.";

// --- Job row shapes ----------------------------------------------------------

export type ClaimedSyncJob = {
  id: string;
  userId: string;
  accountId: string;
  type: SyncJobType;
  status: SyncJobStatus;
  inventoryItemId: string | null;
  marketplaceListingId: string | null;
  attempts: number;
  maxAttempts: number;
  payload: Prisma.JsonValue;
  leaseOwner: string | null;
};

// --- Prisma surfaces ---------------------------------------------------------
// Narrow structural surfaces (not the full PrismaClient) keep these functions
// trivially unit-testable, matching the engine's pattern.

type ClaimCandidateFindMany = {
  where: {
    status: { in: readonly ["queued", "retry_wait"] };
    OR: [{ runAfter: null }, { runAfter: { lte: Date } }];
  };
  select: { id: true };
  take: number;
  orderBy: { createdAt: "asc" };
};

// The reaper sweeps 'running' rows whose updatedAt is older than the cutoff.
type StaleRunningFindMany = {
  where: { status: "running"; updatedAt: { lte: Date } };
  select: {
    id: true;
    type: true;
    attempts: true;
    maxAttempts: true;
    leaseOwner: true;
  };
  take: number;
  orderBy: { updatedAt: "asc" };
};

type ClaimUpdateMany = {
  where: { id: string; status: { in: readonly ["queued", "retry_wait"] } };
  data: {
    status: "running";
    attempts: { increment: number };
    lockedAt: Date;
    leaseOwner: string;
    retryClass: null;
  };
};

// Race-safe reaper writes: each conditional on status:'running' so a row that a
// real worker already moved on is never clobbered. attempts is NOT reset.
type RequeueStaleUpdateMany = {
  where: { id: string; status: "running"; leaseOwner: string };
  data: {
    status: "retry_wait";
    runAfter: Date;
    lockedAt: null;
    leaseOwner: null;
    retryClass: string;
  };
};

type FailStaleUpdateMany = {
  where: { id: string; status: "running"; leaseOwner: string };
  data: {
    status: "failed";
    errorCode: string;
    errorMessage: string;
    lockedAt: null;
    leaseOwner: null;
    retryClass: string;
    completedAt: Date;
  };
};

type ParkStaleExternalUpdateMany = {
  where: { id: string; status: "running"; leaseOwner: string };
  data: {
    status: "needs_review";
    errorCode: string;
    errorMessage: string;
    runAfter: null;
    lockedAt: null;
    leaseOwner: null;
    retryClass: string;
    completedAt: null;
  };
};

type LeaseUpdateMany = {
  where: { id: string; status: "running"; leaseOwner: string };
  data: {
    status?: SyncJobStatus;
    errorCode?: string | null;
    errorMessage?: string | null;
    runAfter?: Date | null;
    lockedAt?: Date | null;
    leaseOwner?: string | null;
    retryClass?: string | null;
    completedAt?: Date | null;
  };
};

type ControlUpdateMany = {
  where: { id: string; status: { in: SyncJobStatus[] } };
  data: {
    status: SyncJobStatus;
    runAfter: Date | null;
    lockedAt: null;
    leaseOwner: null;
    retryClass: string;
    completedAt: Date | null;
    errorCode?: null;
    errorMessage?: null;
  };
};

type WorkerJobDelegate = {
  findMany(args: ClaimCandidateFindMany): Promise<Array<{ id: string }>>;
  findMany(
    args: StaleRunningFindMany,
  ): Promise<
    Array<{
      id: string;
      type: SyncJobType;
      attempts: number;
      maxAttempts: number;
      leaseOwner: string | null;
    }>
  >;
  updateMany(args: ClaimUpdateMany): Promise<{ count: number }>;
  updateMany(args: RequeueStaleUpdateMany): Promise<{ count: number }>;
  updateMany(args: FailStaleUpdateMany): Promise<{ count: number }>;
  updateMany(args: ParkStaleExternalUpdateMany): Promise<{ count: number }>;
  updateMany(args: LeaseUpdateMany): Promise<{ count: number }>;
  updateMany(args: ControlUpdateMany): Promise<{ count: number }>;
  findFirst(args: {
    where: { id: string };
    select: {
      id: true;
      accountId: true;
      inventoryItemId: true;
      attempts: true;
      maxAttempts: true;
      status: true;
      errorCode: true;
      retryClass: true;
    };
  }): Promise<{
    id: string;
    accountId: string;
    inventoryItemId: string | null;
    attempts: number;
    maxAttempts: number;
    status: SyncJobStatus;
    errorCode: string | null;
    retryClass: string | null;
  } | null>;
  findFirst(args: {
    where: { id: string };
    select: {
      id: true;
      userId: true;
      accountId: true;
      type: true;
      status: true;
      inventoryItemId: true;
      marketplaceListingId: true;
      attempts: true;
      maxAttempts: true;
      payload: true;
      leaseOwner: true;
    };
  }): Promise<ClaimedSyncJob | null>;
  update(args: {
    where: { id: string };
    data: {
      status?: SyncJobStatus;
      errorCode?: string | null;
      errorMessage?: string | null;
      runAfter?: Date | null;
      lockedAt?: Date | null;
      leaseOwner?: string | null;
      retryClass?: string | null;
      completedAt?: Date | null;
    };
  }): Promise<{ id: string }>;
};

type WorkerListingRow = {
  id: string;
  marketplace: Marketplace;
  status: MarketplaceListingStatus;
  externalUrl: string | null;
  inventoryItem: {
    accountId: string;
    sellerId: string;
    productName: string;
    status?: InventoryStatus;
  };
};

type WorkerListingDelegate = {
  findFirst(args: {
    where: {
      id: string;
      inventoryItem: { id: string; sellerId?: string; accountId?: string };
    };
    select: {
      id: true;
      marketplace: true;
      status: true;
      externalUrl: true;
      inventoryItem: {
        select: {
          accountId: true;
          sellerId: true;
          productName: true;
          status?: true;
        };
      };
    };
  }): Promise<WorkerListingRow | null>;
  update(args: {
    where: { id: string };
    data: { endedAt: Date };
  }): Promise<{ id: string }>;
};

// After a successful eBay delist, executeEbayDelist internally re-derives the
// master InventoryItem.status (via syncMasterStatusAfterMarketplaceDelist), which
// can flip a just-sold item back to LISTED/DELISTED. The worker re-reads the item
// (ownership-scoped) to detect a sold item whose status was overwritten and
// restore SOLD. Only the two fields needed for that decision are selected.
type WorkerInventoryItemRow = {
  status: InventoryStatus;
  soldSourceMarketplace: Marketplace | null;
};

type WorkerInventoryItemDelegate = {
  findFirst(args: {
    where: { id: string; sellerId: string };
    select: { status: true; soldSourceMarketplace: true };
  }): Promise<WorkerInventoryItemRow | null>;
  update(args: {
    where: { id: string };
    data: { status: InventoryStatus };
  }): Promise<{ id: string }>;
};

type WorkerNotificationDelegate = NotificationPrismaLike["notification"] & {
  findFirst(args: {
    where: {
      userId: string;
      accountId?: string | null;
      kind: string;
      title: string;
      inventoryItemId: string | null;
      readAt: null;
    };
    select: { id: true };
  }): Promise<{ id: string } | null>;
};

export type SyncWorkerPrismaLike = InventoryEventPrismaLike &
  ReviewTaskPrismaLike & {
    syncJob: WorkerJobDelegate;
    marketplaceListing: WorkerListingDelegate;
    inventoryItem: WorkerInventoryItemDelegate;
    notification: WorkerNotificationDelegate;
  };

export type SyncJobControlPrismaLike = InventoryEventPrismaLike & {
  syncJob: {
    findFirst(args: {
      where: { id: string };
      select: {
        id: true;
        accountId: true;
        inventoryItemId: true;
        attempts: true;
        maxAttempts: true;
        status: true;
        errorCode: true;
        retryClass: true;
      };
    }): Promise<{
      id: string;
      accountId: string;
      inventoryItemId: string | null;
      attempts: number;
      maxAttempts: number;
      status: SyncJobStatus;
      errorCode: string | null;
      retryClass: string | null;
    } | null>;
    updateMany(args: ControlUpdateMany): Promise<{ count: number }>;
  };
  $transaction<T>(callback: (tx: SyncJobControlTransaction) => Promise<T>): Promise<T>;
};

type SyncJobControlTransaction = InventoryEventPrismaLike & {
  syncJob: SyncJobControlPrismaLike["syncJob"];
};

// executeEbayDelist needs the full delist-handler surface (publishAttempt,
// marketplaceEvent, ...). The worker passes its db straight through; in
// production it is a real PrismaClient. Injectable for tests.
export type RunSyncJobDeps = {
  ebayDelist?: typeof executeEbayDelist;
  stockxDelist?: typeof executeStockXDelist;
  stockxStatusSync?: typeof syncStockXListingStatus;
  authorizeExecution?: SyncJobExecutionGate;
};

export type SyncJobExecutionGateInput = {
  jobId: string;
  userId: string;
  accountId: string;
  inventoryItemId: string;
  marketplaceListingId: string;
  marketplace: Marketplace;
  operation: "delist" | "status_sync";
};

export type SyncJobExecutionGateDecision = {
  allowed: boolean;
  code: string;
  sellerCopy: string;
};

export type SyncJobExecutionGate = (
  input: SyncJobExecutionGateInput,
) => Promise<SyncJobExecutionGateDecision>;

// --- Claim -------------------------------------------------------------------

/**
 * Find queued, due jobs and CLAIM each atomically. A conditional updateMany
 * (`where: { id, status: 'queued' }`) is the race guard: only the worker whose
 * update flips the row from queued→running sees count===1, so two workers can
 * NEVER both claim the same job. Returns the freshly-claimed job rows (re-read).
 */
export async function claimQueuedSyncJobs(
  db: SyncWorkerPrismaLike = getPrisma() as unknown as SyncWorkerPrismaLike,
  opts: { limit?: number; workerId?: string } = {},
): Promise<ClaimedSyncJob[]> {
  const limit = clampLimit(opts.limit);
  const now = new Date();
  const workerId = opts.workerId?.trim() || randomUUID();

  const candidates = await db.syncJob.findMany({
    where: {
      status: { in: ["queued", "retry_wait"] },
      OR: [{ runAfter: null }, { runAfter: { lte: now } }],
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const claimed: ClaimedSyncJob[] = [];
  for (const { id } of candidates) {
    const leaseOwner = `${workerId}:${randomUUID()}`;
    const result = await db.syncJob.updateMany({
      where: { id, status: { in: ["queued", "retry_wait"] } },
      data: {
        status: "running",
        attempts: { increment: 1 },
        lockedAt: now,
        leaseOwner,
        retryClass: null,
      },
    });
    if (result.count !== 1) continue; // another worker won the claim.

    const job = await readJob(db, id);
    if (job) claimed.push(job);
  }
  return claimed;
}

// --- Run one ------------------------------------------------------------------

export type RunSummary = {
  status: SyncJobStatus;
};

/**
 * Execute a single CLAIMED job. Dispatches by type, then sets a terminal status.
 * Re-running is safe: a job that is no longer in a runnable state is a no-op.
 * maxAttempts is enforced inside each failing branch (see finalizeFailure), so
 * endless retry is impossible.
 */
export async function runSyncJob(
  db: SyncWorkerPrismaLike = getPrisma() as unknown as SyncWorkerPrismaLike,
  jobId: string,
  leaseOwner: string,
  deps: RunSyncJobDeps = {},
): Promise<RunSummary> {
  const job = await readJob(db, jobId);
  // Idempotent no-op: only a claimed (running) job is executable. A job already
  // terminal, still queued, or parked needs_review is left untouched.
  if (!job || job.status !== "running" || job.leaseOwner !== leaseOwner) {
    return { status: job?.status ?? "skipped" };
  }

  switch (job.type) {
    case "delist_marketplace_listing":
      return execDelist(db, job, deps);
    case "detect_status":
      return execDetectStatus(db, job, deps);
    case "notify_user":
      return execNotify(db, job);
    case "create_review_task":
      return execCreateReviewTask(db, job);
    case "mark_sold":
    case "update_inventory_quantity":
    case "update_price":
    case "sync_order":
      return finalizeSkip(
        db,
        job,
        "NOT_IMPLEMENTED",
        `No executor implemented for job type "${job.type}".`,
      );
    default:
      return finalizeSkip(
        db,
        job,
        "NOT_IMPLEMENTED",
        "Unknown job type.",
      );
  }
}

// --- Run a batch -------------------------------------------------------------

export type RunQueuedSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  needsReview: number;
  retryWait: number;
};

/**
 * Claim a batch then run each. Returns a SANITIZED summary only — never job
 * payloads or secrets. Safe to call repeatedly (idempotent per job).
 */
export async function runQueuedSyncJobs(
  db: SyncWorkerPrismaLike = getPrisma() as unknown as SyncWorkerPrismaLike,
  opts: { limit?: number } = {},
  deps: RunSyncJobDeps = {},
): Promise<RunQueuedSummary> {
  const claimedJobs = await claimQueuedSyncJobs(db, opts);
  const summary: RunQueuedSummary = {
    claimed: claimedJobs.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    needsReview: 0,
    retryWait: 0,
  };

  for (const job of claimedJobs) {
    if (!job.leaseOwner) continue;
    const { status } = await runSyncJob(db, job.id, job.leaseOwner, deps);
    switch (status) {
      case "succeeded":
        summary.succeeded += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "skipped":
        summary.skipped += 1;
        break;
      case "needs_review":
        summary.needsReview += 1;
        break;
      case "retry_wait":
        summary.retryWait += 1;
        break;
      default:
        break;
    }
  }
  return summary;
}

// --- Stale-running reaper ----------------------------------------------------

export type RequeueStaleSummary = {
  requeued: number;
  failed: number;
};

export function retryDelayMs(
  attempt: number,
  seed: string,
  baseMs = 1_000,
  maxMs = 15 * 60_000,
): number {
  const exponent = Math.max(0, Math.min(20, attempt - 1));
  const raw = Math.min(maxMs, baseMs * 2 ** exponent);
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const jitter = 0.75 + (hash % 501) / 1_000;
  return Math.max(250, Math.round(raw * jitter));
}

/**
 * Recover jobs stuck in 'running' (a worker crashed mid-run, so they never
 * reached a terminal status and would otherwise sit forever). Finds 'running'
 * rows untouched since `olderThanMinutes` ago, bounded by `limit`, and:
 *   - attempts < maxAttempts => REQUEUE (status -> 'queued', runAfter = now) so a
 *     later pass re-claims them. attempts is NOT reset (the claim already counted).
 *   - attempts >= maxAttempts => FAIL terminal ('failed', MAX_ATTEMPTS_EXHAUSTED)
 *     so endless retry is impossible.
 * Each write is a RACE-SAFE conditional updateMany(where:{id,status:'running'}):
 * count===1 means we won the transition; a row a live worker already finished is
 * skipped. The reaper creates NO events/tasks/notifications (status change only —
 * never duplicates side effects). Returns SANITIZED counts only.
 */
export async function requeueStaleRunningSyncJobs(
  db: SyncWorkerPrismaLike = getPrisma() as unknown as SyncWorkerPrismaLike,
  opts: { olderThanMinutes?: number; limit?: number } = {},
): Promise<RequeueStaleSummary> {
  const limit = clampLimit(opts.limit);
  const minutes = clampStaleMinutes(opts.olderThanMinutes);
  const now = new Date();
  const cutoff = new Date(now.getTime() - minutes * 60_000);

  const stale = await db.syncJob.findMany({
    where: { status: "running", updatedAt: { lte: cutoff } },
    select: {
      id: true,
      type: true,
      attempts: true,
      maxAttempts: true,
      leaseOwner: true,
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  const summary: RequeueStaleSummary = { requeued: 0, failed: 0 };
  for (const job of stale) {
    if (!job.leaseOwner) continue;
    if (job.type === "delist_marketplace_listing") {
      const result = await db.syncJob.updateMany({
        where: { id: job.id, status: "running", leaseOwner: job.leaseOwner },
        data: {
          status: "needs_review",
          errorCode: "DELIST_OUTCOME_UNKNOWN",
          errorMessage:
            "The prior delist attempt may have reached the marketplace. Reconcile the listing before retrying.",
          runAfter: null,
          lockedAt: null,
          leaseOwner: null,
          retryClass: "external_reconciliation",
          completedAt: null,
        },
      });
      if (result.count === 1) summary.requeued += 1;
      continue;
    }
    if (job.attempts < job.maxAttempts) {
      const runAfter = new Date(now.getTime() + retryDelayMs(job.attempts, job.id));
      const result = await db.syncJob.updateMany({
        where: { id: job.id, status: "running", leaseOwner: job.leaseOwner },
        data: {
          status: "retry_wait",
          runAfter,
          lockedAt: null,
          leaseOwner: null,
          retryClass: "stale_recovery",
        },
      });
      if (result.count === 1) summary.requeued += 1;
    } else {
      const result = await db.syncJob.updateMany({
        where: { id: job.id, status: "running", leaseOwner: job.leaseOwner },
        data: {
          status: "failed",
          errorCode: "MAX_ATTEMPTS_EXHAUSTED",
          errorMessage: safeFailureText(
            MAX_ATTEMPTS_EXHAUSTED_MESSAGE,
            MAX_ATTEMPTS_EXHAUSTED_MESSAGE,
          ),
          lockedAt: null,
          leaseOwner: null,
          retryClass: "attempts_exhausted",
          completedAt: now,
        },
      });
      if (result.count === 1) summary.failed += 1;
    }
  }
  return summary;
}

export async function retrySyncJobForAdmin(
  db: SyncJobControlPrismaLike,
  jobId: string,
  adminUserId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const job = await readControlJob(tx, jobId);
    if (
      !job ||
      job.attempts >= job.maxAttempts ||
      job.retryClass === "external_reconciliation"
    ) return false;
    const result = await tx.syncJob.updateMany({
      where: { id: jobId, status: { in: ["failed", "needs_review"] } },
      data: {
        status: "queued",
        runAfter: new Date(),
        lockedAt: null,
        leaseOwner: null,
        retryClass: "admin_retry",
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (result.count === 1 && job.inventoryItemId) {
      await recordInventoryEvent(tx, {
        inventoryItemId: job.inventoryItemId,
        userId: adminUserId,
        accountId: job.accountId,
        type: "sync_conflict",
        source: "system",
        payload: { syncJobId: job.id, action: "admin_retry" } as Prisma.InputJsonValue,
      });
    }
    return result.count === 1;
  });
}

export async function cancelSyncJob(
  db: SyncJobControlPrismaLike,
  jobId: string,
  actorUserId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const job = await readControlJob(tx, jobId);
    if (!job) return false;
    const result = await tx.syncJob.updateMany({
      where: { id: jobId, status: { in: ["queued", "retry_wait", "needs_review"] } },
      data: {
        status: "canceled",
        runAfter: null,
        lockedAt: null,
        leaseOwner: null,
        retryClass: "canceled",
        completedAt: new Date(),
      },
    });
    if (result.count === 1 && job.inventoryItemId) {
      await recordInventoryEvent(tx, {
        inventoryItemId: job.inventoryItemId,
        userId: actorUserId,
        accountId: job.accountId,
        type: "sync_conflict",
        source: "system",
        payload: { syncJobId: job.id, action: "canceled" } as Prisma.InputJsonValue,
      });
    }
    return result.count === 1;
  });
}

// --- Executor: delist_marketplace_listing ------------------------------------

type DelistPayload = {
  inventoryItemId?: unknown;
  marketplaceListingId?: unknown;
  marketplace?: unknown;
  soldMarketplace?: unknown;
  useAdapter?: unknown;
  accountId?: unknown;
};

const TERMINAL_LISTING_STATUSES: ReadonlySet<MarketplaceListingStatus> =
  new Set<MarketplaceListingStatus>(["DELISTED", "ENDED", "SOLD"]);

async function execDelist(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  deps: RunSyncJobDeps,
): Promise<RunSummary> {
  const payload = (job.payload ?? {}) as DelistPayload;
  const inventoryItemId = job.inventoryItemId;
  const marketplaceListingId = job.marketplaceListingId;
  const soldMarketplace =
    typeof payload.soldMarketplace === "string"
      ? (payload.soldMarketplace as Marketplace)
      : null;

  if (!inventoryItemId || !marketplaceListingId) {
    return parkJobIntegrityReview(db, job, "JOB_REFERENCE_MISSING");
  }
  if (
    duplicatedFieldMismatch(payload.inventoryItemId, inventoryItemId) ||
    duplicatedFieldMismatch(payload.marketplaceListingId, marketplaceListingId) ||
    duplicatedFieldMismatch(payload.accountId, job.accountId)
  ) {
    return parkJobIntegrityReview(db, job, "JOB_PAYLOAD_REFERENCE_MISMATCH");
  }

  // Scope by account when the queueing path provided it; legacy jobs remain
  // owner-scoped. This keeps shared-account delists from becoming false no-ops.
  const listing = await db.marketplaceListing.findFirst({
    where: {
      id: marketplaceListingId,
      inventoryItem: {
        id: inventoryItemId,
        ...listingOwnerScope(job.userId, job.accountId ?? undefined),
      },
    },
    select: {
      id: true,
      marketplace: true,
      status: true,
      externalUrl: true,
      inventoryItem: {
        select: {
          accountId: true,
          sellerId: true,
          productName: true,
        },
      },
    },
  });

  if (!listing) {
    return parkJobIntegrityReview(db, job, "AUTHORITATIVE_LISTING_NOT_FOUND");
  }
  if (
    typeof payload.marketplace === "string" &&
    payload.marketplace !== listing.marketplace
  ) {
    return parkJobIntegrityReview(db, job, "JOB_PAYLOAD_MARKETPLACE_MISMATCH");
  }
  if (TERMINAL_LISTING_STATUSES.has(listing.status)) {
    return finalizeSucceeded(db, job);
  }

  // Never delist the marketplace the sale came from.
  if (soldMarketplace && listing.marketplace === soldMarketplace) {
    return finalizeSkip(
      db,
      job,
      "SOLD_SOURCE",
      "Listing is on the sold-source marketplace; not delisting.",
    );
  }

  // A second marketplace can report the same item sold after the first signal
  // has already queued cleanup. Re-check the durable, account-scoped review
  // state immediately before any adapter execution so that queued work cannot
  // turn a sold-source conflict into an automated destructive follow-up.
  const conflictHold = await parkIfOpenSyncConflict(db, job, inventoryItemId);
  if (conflictHold) return conflictHold;

  if (listing.marketplace === "ebay") {
    const gate = await authorizeOrPark(
      db,
      job,
      listing,
      inventoryItemId,
      marketplaceListingId,
      "delist",
      deps,
    );
    if (gate) return gate;
    return execEbayDelist(db, job, inventoryItemId, listing, soldMarketplace, deps);
  }

  if (listing.marketplace === "stockx") {
    const gate = await authorizeOrPark(
      db,
      job,
      listing,
      inventoryItemId,
      marketplaceListingId,
      "delist",
      deps,
    );
    if (gate) return gate;
    return execStockXDelist(db, job, inventoryItemId, listing, soldMarketplace, deps);
  }

  // Non-adapter marketplaces are defensive only: these are normally enqueued as
  // needs_review and never claimed. NEVER fake a delist for a marketplace with
  // no adapter.
  await parkForManualDelist(db, job, listing, soldMarketplace, false);
  return finalizeNeedsReview(db, job, "MANUAL_DELIST_REQUIRED");
}

async function parkIfOpenSyncConflict(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  inventoryItemId: string,
): Promise<RunSummary | null> {
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  const conflict = await db.reviewTask.findFirst({
    where: {
      accountId: job.accountId,
      type: "sync_conflict",
      status: "open",
      inventoryItemId,
    },
    select: { id: true },
  });
  if (!conflict) return null;
  return finalizeNeedsReview(db, job, "OPEN_SYNC_CONFLICT_REVIEW_REQUIRED");
}

async function execEbayDelist(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  inventoryItemId: string,
  listing: WorkerListingRow,
  soldMarketplace: Marketplace | null,
  deps: RunSyncJobDeps,
): Promise<RunSummary> {
  const ebayDelist = deps.ebayDelist ?? executeEbayDelist;
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  try {
    // executeEbayDelist is ownership-scoped, records its own MarketplaceEvents,
    // and sets the eBay MarketplaceListing to DELISTED on success. It THROWS on
    // any non-delistable / missing-ID condition — we never fabricate success.
    await ebayDelist(db as unknown as MarketplaceDelistHandlerPrismaLike, {
      userId: job.userId,
      accountId: listing.inventoryItem.accountId ?? undefined,
      inventoryItemId,
      confirmLiveDelist: true,
    });
  } catch (error) {
    if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
    await recordInventoryEvent(db, {
      inventoryItemId,
      userId: job.userId,
      accountId: job.accountId,
      type: "delist_failed",
      source: "system",
      marketplace: listing.marketplace,
      payload: {
        marketplaceListingId: listing.id,
        // Sanitized: never persist raw provider/DB/internal text.
        reason: safeFailureText(
          error instanceof Error ? error.message : undefined,
          "The eBay delist could not be completed.",
        ),
        syncJobId: job.id,
      } as Prisma.InputJsonValue,
    });
    await parkForManualDelist(db, job, listing, soldMarketplace, true);
    return finalizeExternalOutcomeUnknown(db, job, error);
  }

  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);

  // executeEbayDelist already flipped the listing to DELISTED; we additionally
  // stamp endedAt for the safety-layer timeline.
  await db.marketplaceListing.update({
    where: { id: listing.id },
    data: { endedAt: new Date() },
  });
  await recordInventoryEvent(db, {
    inventoryItemId,
    userId: job.userId,
    accountId: job.accountId,
    type: "delist_succeeded",
    source: "system",
    marketplace: listing.marketplace,
    payload: {
      marketplaceListingId: listing.id,
      syncJobId: job.id,
    } as Prisma.InputJsonValue,
  });

  // A SOLD item must stay SOLD. executeEbayDelist runs
  // syncMasterStatusAfterMarketplaceDelist internally, which re-derives the master
  // InventoryItem.status from the remaining listings and can overwrite the SOLD
  // that markItemSold just wrote (flipping it back to LISTED/DELISTED). Re-read the
  // item (ownership-scoped): if it is sold (soldSourceMarketplace set) but its
  // status was clobbered, restore SOLD with a single update.
  await restoreSoldStatusIfClobbered(
    db,
    listing.inventoryItem.sellerId,
    inventoryItemId,
  );

  return finalizeSucceeded(db, job);
}

async function execStockXDelist(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  inventoryItemId: string,
  listing: WorkerListingRow,
  soldMarketplace: Marketplace | null,
  deps: RunSyncJobDeps,
): Promise<RunSummary> {
  const stockxDelist = deps.stockxDelist ?? executeStockXDelist;
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  try {
    await stockxDelist(db as unknown as MarketplaceDelistHandlerPrismaLike, {
      userId: job.userId,
      accountId: listing.inventoryItem.accountId ?? undefined,
      inventoryItemId,
      confirmLiveDelist: true,
    });
  } catch (error) {
    if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
    await recordInventoryEvent(db, {
      inventoryItemId,
      userId: job.userId,
      accountId: job.accountId,
      type: "delist_failed",
      source: "system",
      marketplace: listing.marketplace,
      payload: {
        marketplaceListingId: listing.id,
        reason: safeFailureText(
          error instanceof Error ? error.message : undefined,
          "The StockX delist could not be completed.",
        ),
        syncJobId: job.id,
      } as Prisma.InputJsonValue,
    });
    await parkForManualDelist(db, job, listing, null, true);
    return finalizeExternalOutcomeUnknown(db, job, error);
  }

  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);

  await db.marketplaceListing.update({
    where: { id: listing.id },
    data: { endedAt: new Date() },
  });
  await recordInventoryEvent(db, {
    inventoryItemId,
    userId: job.userId,
    accountId: job.accountId,
    type: "delist_succeeded",
    source: "system",
    marketplace: listing.marketplace,
    payload: {
      marketplaceListingId: listing.id,
      syncJobId: job.id,
    } as Prisma.InputJsonValue,
  });

  await restoreSoldStatusIfClobbered(
    db,
    listing.inventoryItem.sellerId,
    inventoryItemId,
  );

  return finalizeSucceeded(db, job);
}

async function restoreSoldStatusIfClobbered(
  db: SyncWorkerPrismaLike,
  userId: string,
  inventoryItemId: string,
): Promise<void> {
  const item = await db.inventoryItem.findFirst({
    where: { id: inventoryItemId, sellerId: userId },
    select: { status: true, soldSourceMarketplace: true },
  });
  if (item && item.soldSourceMarketplace !== null && item.status !== "SOLD") {
    await db.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { status: "SOLD" },
    });
  }
}

// Create (deduped) a manual_delist_required review task + a delist_failed
// notification so the seller can end the listing themselves.
async function parkForManualDelist(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  listing: WorkerListingRow,
  soldMarketplace: Marketplace | null,
  automatedAttemptFailed: boolean,
): Promise<void> {
  const inventoryItemId = job.inventoryItemId ?? "";
  await createReviewTask(db, {
    userId: job.userId,
    accountId: job.accountId,
    type: "manual_delist_required",
    inventoryItemId: job.inventoryItemId,
    marketplace: listing.marketplace,
    title: `Remove this listing from ${listing.marketplace}`,
    description:
      `We couldn't end your ${listing.marketplace} listing automatically` +
      (listing.externalUrl ? ` (${listing.externalUrl})` : "") +
      `. Please end it now so the item can't sell twice.`,
    payload: {
      inventoryItemId,
      marketplaceListingId: listing.id,
      marketplace: listing.marketplace,
      soldMarketplace,
      externalUrl: listing.externalUrl,
      syncJobId: job.id,
    } as Prisma.InputJsonValue,
  });
  if (automatedAttemptFailed) {
    const copy = delistFailedCopy({
      productName: listing.inventoryItem.productName,
      marketplace: listing.marketplace,
    });
    const existing = await db.notification.findFirst({
      where: {
        userId: job.userId,
        accountId: job.accountId,
        kind: copy.kind,
        title: copy.title,
        inventoryItemId: job.inventoryItemId,
        readAt: null,
      },
      select: { id: true },
    });
    if (!existing) {
      await createNotification(db, {
        userId: job.userId,
        accountId: job.accountId,
        inventoryItemId: job.inventoryItemId,
        ...copy,
      });
    }
  }
}

// --- Executor: detect_status -------------------------------------------------

type DetectStatusPayload = {
  inventoryItemId?: unknown;
  marketplaceListingId?: unknown;
  accountId?: unknown;
};

async function execDetectStatus(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  deps: RunSyncJobDeps,
): Promise<RunSummary> {
  const payload = (job.payload ?? {}) as DetectStatusPayload;
  const inventoryItemId = job.inventoryItemId;
  const marketplaceListingId = job.marketplaceListingId;

  if (!inventoryItemId || !marketplaceListingId) {
    return parkJobIntegrityReview(db, job, "JOB_REFERENCE_MISSING");
  }
  if (
    duplicatedFieldMismatch(payload.inventoryItemId, inventoryItemId) ||
    duplicatedFieldMismatch(payload.marketplaceListingId, marketplaceListingId) ||
    duplicatedFieldMismatch(payload.accountId, job.accountId)
  ) {
    return parkJobIntegrityReview(db, job, "JOB_PAYLOAD_REFERENCE_MISMATCH");
  }

  const listing = await db.marketplaceListing.findFirst({
    where: {
      id: marketplaceListingId,
      inventoryItem: {
        id: inventoryItemId,
        ...listingOwnerScope(job.userId, job.accountId),
      },
    },
    select: {
      id: true,
      marketplace: true,
      status: true,
      externalUrl: true,
      inventoryItem: {
        select: {
          accountId: true,
          sellerId: true,
          productName: true,
          status: true,
        },
      },
    },
  });

  if (!listing) {
    return parkJobIntegrityReview(db, job, "AUTHORITATIVE_LISTING_NOT_FOUND");
  }
  // A source listing can have been marked SOLD by an older split write while
  // the canonical item and its required delist jobs were never committed. Only
  // short-circuit SOLD when the master item confirms the reconciliation.
  if (
    TERMINAL_LISTING_STATUSES.has(listing.status) &&
    (listing.status !== "SOLD" || listing.inventoryItem.status === "SOLD")
  ) {
    return finalizeSucceeded(db, job);
  }

  if (listing.marketplace !== "stockx") {
    return finalizeSkip(
      db,
      job,
      "NOT_IMPLEMENTED",
      `No status-sync executor implemented for marketplace "${listing.marketplace}".`,
    );
  }

  const stockxStatusSync = deps.stockxStatusSync ?? syncStockXListingStatus;
  const gate = await authorizeOrPark(
    db,
    job,
    listing,
    inventoryItemId,
    marketplaceListingId,
    "status_sync",
    deps,
  );
  if (gate) return gate;
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  try {
    const result = await stockxStatusSync(db as unknown as StockXStatusSyncPrismaLike, {
      userId: job.userId,
      accountId: listing.inventoryItem.accountId,
      inventoryItemId,
      marketplaceListingId,
    });
    if (result.status === "unknown") {
      return finalizePendingStockXStatus(db, job, listing);
    }
  } catch (error) {
    await recordInventoryEvent(db, {
      inventoryItemId,
      userId: job.userId,
      accountId: job.accountId,
      type: "sync_conflict",
      source: "system",
      marketplace: listing.marketplace,
      payload: {
        marketplaceListingId: listing.id,
        reason: safeFailureText(
          error instanceof Error ? error.message : undefined,
          "The StockX status sync could not be completed.",
        ),
        syncJobId: job.id,
      } as Prisma.InputJsonValue,
    });
    return finalizeFailure(db, job, "STATUS_SYNC_FAILED", error, {
      fallback: "The StockX status sync could not be completed.",
    });
  }

  return finalizeSucceeded(db, job);
}

async function finalizePendingStockXStatus(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  listing: WorkerListingRow,
): Promise<RunSummary> {
  if (job.attempts < job.maxAttempts) {
    const result = await db.syncJob.updateMany({
      where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
      data: {
        status: "retry_wait",
        errorCode: "STOCKX_STATUS_PENDING",
        errorMessage: "StockX is still processing this listing. Sello will check again.",
        runAfter: new Date(Date.now() + retryDelayMs(job.attempts, job.id)),
        lockedAt: null,
        leaseOwner: null,
        retryClass: "transient",
        completedAt: null,
      },
    });
    return result.count === 1
      ? { status: "retry_wait" }
      : currentJobSummary(db, job.id);
  }

  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  const dedupeKey = `sync-job:${job.id}:stockx-status-pending`;
  await createReviewTask(db, {
    userId: job.userId,
    accountId: job.accountId,
    type: "sync_conflict",
    inventoryItemId: job.inventoryItemId,
    marketplace: "stockx",
    title: "Review pending StockX listing status",
    description:
      "StockX has not returned a final listing status after repeated checks. Review the listing before taking further action.",
    dedupeKey,
    payload: {
      syncJobId: job.id,
      marketplaceListingId: listing.id,
      reasonCode: "STOCKX_STATUS_PENDING",
    } as Prisma.InputJsonValue,
  });
  await createNotification(db, {
    userId: job.userId,
    accountId: job.accountId,
    inventoryItemId: job.inventoryItemId,
    kind: "sync_conflict",
    title: "StockX listing status needs review",
    body:
      "StockX is still processing this listing after repeated checks. Review it before making another marketplace change.",
    dedupeKey,
  });
  return finalizeNeedsReview(db, job, "STOCKX_STATUS_REVIEW_REQUIRED");
}

// --- Executor: notify_user ---------------------------------------------------

type NotifyPayload = {
  userId?: unknown;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  inventoryItemId?: unknown;
};

async function execNotify(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
): Promise<RunSummary> {
  const payload = (job.payload ?? {}) as NotifyPayload;
  const userId = job.userId;
  const kind = typeof payload.kind === "string" ? payload.kind : null;
  const title = typeof payload.title === "string" ? payload.title : null;
  const body = typeof payload.body === "string" ? payload.body : null;
  const inventoryItemId = job.inventoryItemId;

  if (
    duplicatedFieldMismatch(payload.userId, userId) ||
    duplicatedFieldMismatch(payload.inventoryItemId, inventoryItemId)
  ) {
    return parkJobIntegrityReview(db, job, "JOB_PAYLOAD_REFERENCE_MISMATCH");
  }

  if (!kind || !title || !body) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The notification job payload was incomplete.",
    });
  }
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);

  // Best-effort dedupe: skip if an identical unread Notification already exists
  // for this user+kind+inventoryItemId+title.
  const existing = await db.notification.findFirst({
    where: {
      userId,
      accountId: job.accountId,
      kind,
      title,
      inventoryItemId: inventoryItemId ?? null,
      readAt: null,
    },
    select: { id: true },
  });

  if (!existing) {
    await createNotification(db, {
      userId,
      accountId: job.accountId,
      kind,
      title,
      body,
      inventoryItemId: inventoryItemId ?? null,
    });
    if (inventoryItemId) {
      await recordInventoryEvent(db, {
        inventoryItemId,
        userId,
        accountId: job.accountId,
        type: "notification_sent",
        source: "system",
        payload: { kind, title, syncJobId: job.id } as Prisma.InputJsonValue,
      });
    }
  }

  return finalizeSucceeded(db, job);
}

// --- Executor: create_review_task --------------------------------------------

type ReviewTaskPayload = {
  userId?: unknown;
  type?: unknown;
  inventoryItemId?: unknown;
  marketplace?: unknown;
  title?: unknown;
  description?: unknown;
  payload?: unknown;
};

async function execCreateReviewTask(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
): Promise<RunSummary> {
  const payload = (job.payload ?? {}) as ReviewTaskPayload;
  const userId = job.userId;
  const type = typeof payload.type === "string" ? payload.type : null;
  const title = typeof payload.title === "string" ? payload.title : null;
  const description =
    typeof payload.description === "string" ? payload.description : null;

  if (
    duplicatedFieldMismatch(payload.userId, userId) ||
    duplicatedFieldMismatch(payload.inventoryItemId, job.inventoryItemId)
  ) {
    return parkJobIntegrityReview(db, job, "JOB_PAYLOAD_REFERENCE_MISMATCH");
  }

  if (!type || !title || !description) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The review-task job payload was incomplete.",
    });
  }
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);

  // createReviewTask already dedupes open tasks by type+inventoryItemId+marketplace.
  await createReviewTask(db, {
    userId,
    accountId: job.accountId,
    type: type as Parameters<typeof createReviewTask>[1]["type"],
    inventoryItemId: job.inventoryItemId,
    marketplace:
      typeof payload.marketplace === "string"
        ? (payload.marketplace as Marketplace)
        : null,
    title,
    description,
    payload: (payload.payload ?? {}) as Prisma.InputJsonValue,
  });
  return finalizeSucceeded(db, job);
}

// --- Terminal-status helpers -------------------------------------------------

async function finalizeSucceeded(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
): Promise<RunSummary> {
  const result = await db.syncJob.updateMany({
    where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
    data: {
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      runAfter: null,
      lockedAt: null,
      leaseOwner: null,
      retryClass: null,
      completedAt: new Date(),
    },
  });
  return result.count === 1 ? { status: "succeeded" } : currentJobSummary(db, job.id);
}

async function finalizeSkip(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  code: string,
  message: string,
): Promise<RunSummary> {
  const result = await db.syncJob.updateMany({
    where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
    data: {
      status: "skipped",
      errorCode: code,
      errorMessage: safeFailureText(message, "The sync job was skipped."),
      runAfter: null,
      lockedAt: null,
      leaseOwner: null,
      retryClass: "terminal",
      completedAt: new Date(),
    },
  });
  return result.count === 1 ? { status: "skipped" } : currentJobSummary(db, job.id);
}

async function finalizeNeedsReview(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  code: string,
): Promise<RunSummary> {
  const result = await db.syncJob.updateMany({
    where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
    data: {
      status: "needs_review",
      errorCode: code,
      errorMessage: "Seller review is required before this job can continue.",
      runAfter: null,
      lockedAt: null,
      leaseOwner: null,
      retryClass: "manual_review",
      completedAt: null,
    },
  });
  return result.count === 1
    ? { status: "needs_review" }
    : currentJobSummary(db, job.id);
}

async function finalizeFailure(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  code: string,
  error: unknown,
  opts: { fallback?: string } = {},
): Promise<RunSummary> {
  const retryable = isRetryableFailure(code, error);
  if (retryable && job.attempts < job.maxAttempts) {
    const runAfter = new Date(Date.now() + retryDelayMs(job.attempts, job.id));
    const result = await db.syncJob.updateMany({
      where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
      data: {
        status: "retry_wait",
        errorCode: code,
        errorMessage: safeFailureText(
          error instanceof Error ? error.message : undefined,
          opts.fallback ?? "The sync job will be retried.",
        ),
        runAfter,
        lockedAt: null,
        leaseOwner: null,
        retryClass: "transient",
        completedAt: null,
      },
    });
    return result.count === 1
      ? { status: "retry_wait" }
      : currentJobSummary(db, job.id);
  }
  const result = await db.syncJob.updateMany({
    where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
    data: {
      status: "failed",
      errorCode: code,
      errorMessage: safeFailureText(
        error instanceof Error ? error.message : undefined,
        opts.fallback ?? "The sync job failed.",
      ),
      runAfter: null,
      lockedAt: null,
      leaseOwner: null,
      retryClass: retryable ? "attempts_exhausted" : "terminal",
      completedAt: new Date(),
    },
  });
  return result.count === 1 ? { status: "failed" } : currentJobSummary(db, job.id);
}

// Once an external delist was attempted, a timeout, 5xx, or unknown result is
// ambiguous: the marketplace may have applied the write. Never issue a blind
// second write. Park for reconciliation/manual review after exactly one call.
async function finalizeExternalOutcomeUnknown(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  error?: unknown,
): Promise<RunSummary> {
  const message = safeFailureText(
    error instanceof Error ? error.message : undefined,
    "The delist could not be completed automatically.",
  );
  const status = failureStatus(error);
  const uncertain = status === null || status === 408 || status === 429 || status >= 500;
  const result = await db.syncJob.updateMany({
    where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
    data: {
      status: "needs_review",
      errorCode: uncertain
        ? "DELIST_OUTCOME_UNKNOWN"
        : "DELIST_MANUAL_REVIEW_REQUIRED",
      errorMessage: message,
      runAfter: null,
      lockedAt: null,
      leaseOwner: null,
      retryClass: uncertain ? "external_reconciliation" : "manual_review",
      completedAt: null,
    },
  });
  return result.count === 1
    ? { status: "needs_review" }
    : currentJobSummary(db, job.id);
}

function requiredLease(job: ClaimedSyncJob): string {
  if (!job.leaseOwner) {
    throw new Error("A running sync job must have a lease token.");
  }
  return job.leaseOwner;
}

async function heartbeatLease(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
): Promise<boolean> {
  const result = await db.syncJob.updateMany({
    where: { id: job.id, status: "running", leaseOwner: requiredLease(job) },
    data: { lockedAt: new Date() },
  });
  return result.count === 1;
}

async function currentJobSummary(
  db: SyncWorkerPrismaLike,
  jobId: string,
): Promise<RunSummary> {
  const current = await readJob(db, jobId);
  return { status: current?.status ?? "skipped" };
}

function duplicatedFieldMismatch(
  duplicated: unknown,
  authoritative: string | null,
): boolean {
  if (duplicated === undefined) return false;
  return duplicated !== authoritative;
}

async function authorizeOrPark(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  listing: WorkerListingRow,
  inventoryItemId: string,
  marketplaceListingId: string,
  operation: "delist" | "status_sync",
  deps: RunSyncJobDeps,
): Promise<RunSummary | null> {
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  let decision: SyncJobExecutionGateDecision;
  try {
    decision = deps.authorizeExecution
      ? await deps.authorizeExecution({
          jobId: job.id,
          userId: job.userId,
          accountId: job.accountId,
          inventoryItemId,
          marketplaceListingId,
          marketplace: listing.marketplace,
          operation,
        })
      : {
          allowed: false,
          code: "EXECUTION_GATE_UNAVAILABLE",
          sellerCopy: "Automatic marketplace actions are temporarily unavailable.",
        };
  } catch {
    decision = {
      allowed: false,
      code: "EXECUTION_GATE_FAILED",
      sellerCopy: "Automatic marketplace actions are temporarily unavailable.",
    };
  }
  if (decision.allowed) return null;
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);

  await createReviewTask(db, {
    userId: job.userId,
    accountId: job.accountId,
    type: "sync_conflict",
    inventoryItemId: job.inventoryItemId,
    marketplace: listing.marketplace,
    title: `Urgent: review blocked ${listing.marketplace} automation`,
    description:
      `${safeFailureText(decision.sellerCopy, "Automatic marketplace action was blocked.")} ` +
      "Review the listing and take any required manual action now.",
    dedupeKey: `sync-job:${job.id}:execution-gate`,
    payload: {
      syncJobId: job.id,
      marketplaceListingId: listing.id,
      reasonCode: decision.code,
      operation,
    } as Prisma.InputJsonValue,
  });
  await createNotification(db, {
    userId: job.userId,
    accountId: job.accountId,
    inventoryItemId: job.inventoryItemId,
    kind: "sync_conflict",
    title: `Urgent: ${listing.marketplace} listing needs review`,
    body:
      "Sello blocked an automatic marketplace action for safety. Review this listing and take any required manual action now.",
    dedupeKey: `sync-job:${job.id}:execution-gate`,
  });
  return finalizeNeedsReview(db, job, decision.code);
}

async function parkJobIntegrityReview(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  code: string,
): Promise<RunSummary> {
  if (!(await heartbeatLease(db, job))) return currentJobSummary(db, job.id);
  await createReviewTask(db, {
    userId: job.userId,
    accountId: job.accountId,
    type: "sync_conflict",
    inventoryItemId: job.inventoryItemId,
    marketplace: null,
    title: "Urgent: sync job references need review",
    description:
      "Sello found inconsistent or missing authoritative listing references and stopped before contacting a marketplace.",
    dedupeKey: `sync-job:${job.id}:integrity`,
    payload: {
      syncJobId: job.id,
      reasonCode: code,
      marketplaceListingId: job.marketplaceListingId,
    } as Prisma.InputJsonValue,
  });
  await createNotification(db, {
    userId: job.userId,
    accountId: job.accountId,
    inventoryItemId: job.inventoryItemId,
    kind: "sync_conflict",
    title: "Urgent: listing sync needs review",
    body:
      "Sello stopped a sync action because its listing references were inconsistent or missing. Review the listing before taking further action.",
    dedupeKey: `sync-job:${job.id}:integrity`,
  });
  return finalizeNeedsReview(db, job, code);
}

function isRetryableFailure(code: string, error: unknown): boolean {
  if (code === "INVALID_PAYLOAD" || code === "NOT_IMPLEMENTED") return false;
  const status = failureStatus(error);
  if (status !== null) return status === 408 || status === 429 || status >= 500;
  return code === "STATUS_SYNC_FAILED" || code.includes("TIMEOUT") || code.includes("UNAVAILABLE");
}

function failureStatus(error: unknown): number | null {
  return (
    error && typeof error === "object" && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : error && typeof error === "object" && "details" in error &&
          (error as { details?: unknown }).details &&
          typeof (error as { details: { status?: unknown } }).details.status === "number"
        ? (error as { details: { status: number } }).details.status
        : null
  );
}

// --- internals ---------------------------------------------------------------

function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_CLAIM_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_CLAIM_LIMIT);
}

// Clamp the stale-running window to [MIN, MAX] minutes; a missing/garbage value
// falls back to the default. Never trust the caller to bound this — a tiny window
// would requeue freshly-claimed jobs that are still legitimately running.
function clampStaleMinutes(minutes?: number): number {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    return DEFAULT_STALE_MINUTES;
  }
  return Math.min(Math.max(Math.floor(minutes), MIN_STALE_MINUTES), MAX_STALE_MINUTES);
}

function listingOwnerScope(
  userId: string,
  accountId?: string,
): { sellerId?: string; accountId?: string } {
  return accountId ? { accountId } : { sellerId: userId };
}

async function readJob(
  db: SyncWorkerPrismaLike,
  id: string,
): Promise<ClaimedSyncJob | null> {
  return db.syncJob.findFirst({
    where: { id },
    select: {
      id: true,
      userId: true,
      accountId: true,
      type: true,
      status: true,
      inventoryItemId: true,
      marketplaceListingId: true,
      attempts: true,
      maxAttempts: true,
      payload: true,
      leaseOwner: true,
    },
  });
}

async function readControlJob(
  db: SyncJobControlTransaction,
  id: string,
) {
  return db.syncJob.findFirst({
    where: { id },
    select: {
      id: true,
      accountId: true,
      inventoryItemId: true,
      attempts: true,
      maxAttempts: true,
      status: true,
      errorCode: true,
      retryClass: true,
    },
  });
}
