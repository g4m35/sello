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
// in-memory fake. The only live side effect ever performed here is the eBay
// delist, and that goes exclusively through the existing, ownership-scoped
// executeEbayDelist (never reimplemented). No secrets are logged; every error is
// scrubbed via safeFailureText before it is persisted to a job/event/task.

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
  accountId: string | null;
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
  select: { id: true; attempts: true; maxAttempts: true };
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
  where: { id: string; status: "running" };
  data: {
    status: "retry_wait";
    runAfter: Date;
    lockedAt: null;
    leaseOwner: null;
    retryClass: string;
  };
};

type FailStaleUpdateMany = {
  where: { id: string; status: "running" };
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
  ): Promise<Array<{ id: string; attempts: number; maxAttempts: number }>>;
  updateMany(args: ClaimUpdateMany): Promise<{ count: number }>;
  updateMany(args: RequeueStaleUpdateMany): Promise<{ count: number }>;
  updateMany(args: FailStaleUpdateMany): Promise<{ count: number }>;
  updateMany(args: ControlUpdateMany): Promise<{ count: number }>;
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
  inventoryItem: { accountId: string | null; sellerId: string; productName: string };
};

type WorkerListingDelegate = {
  findFirst(args: {
    where: {
      id: string;
      inventoryItem: { sellerId?: string; accountId?: string };
    };
    select: {
      id: true;
      marketplace: true;
      status: true;
      externalUrl: true;
      inventoryItem: { select: { accountId: true; sellerId: true; productName: true } };
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
      };
    }): Promise<{
      id: string;
      accountId: string | null;
      inventoryItemId: string | null;
      attempts: number;
      maxAttempts: number;
      status: SyncJobStatus;
    } | null>;
    updateMany(args: ControlUpdateMany): Promise<{ count: number }>;
  };
};

// executeEbayDelist needs the full delist-handler surface (publishAttempt,
// marketplaceEvent, ...). The worker passes its db straight through; in
// production it is a real PrismaClient. Injectable for tests.
export type RunSyncJobDeps = {
  ebayDelist?: typeof executeEbayDelist;
  stockxDelist?: typeof executeStockXDelist;
  stockxStatusSync?: typeof syncStockXListingStatus;
};

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
    const result = await db.syncJob.updateMany({
      where: { id, status: { in: ["queued", "retry_wait"] } },
      data: {
        status: "running",
        attempts: { increment: 1 },
        lockedAt: now,
        leaseOwner: workerId,
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
  deps: RunSyncJobDeps = {},
): Promise<RunSummary> {
  const job = await readJob(db, jobId);
  // Idempotent no-op: only a claimed (running) job is executable. A job already
  // terminal, still queued, or parked needs_review is left untouched.
  if (!job || job.status !== "running") {
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
        job.id,
        "NOT_IMPLEMENTED",
        `No executor implemented for job type "${job.type}".`,
      );
    default:
      return finalizeSkip(
        db,
        job.id,
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
    const { status } = await runSyncJob(db, job.id, deps);
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
    select: { id: true, attempts: true, maxAttempts: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  const summary: RequeueStaleSummary = { requeued: 0, failed: 0 };
  for (const job of stale) {
    if (job.attempts < job.maxAttempts) {
      const runAfter = new Date(now.getTime() + retryDelayMs(job.attempts, job.id));
      const result = await db.syncJob.updateMany({
        where: { id: job.id, status: "running" },
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
        where: { id: job.id, status: "running" },
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
  const job = await readControlJob(db, jobId);
  if (!job || job.attempts >= job.maxAttempts) return false;
  const result = await db.syncJob.updateMany({
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
    await recordInventoryEvent(db, {
      inventoryItemId: job.inventoryItemId,
      userId: adminUserId,
      accountId: job.accountId,
      type: "sync_conflict",
      source: "system",
      payload: { syncJobId: job.id, action: "admin_retry" } as Prisma.InputJsonValue,
    });
  }
  return result.count === 1;
}

export async function cancelSyncJob(
  db: SyncJobControlPrismaLike,
  jobId: string,
  actorUserId: string,
): Promise<boolean> {
  const job = await readControlJob(db, jobId);
  if (!job) return false;
  const result = await db.syncJob.updateMany({
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
    await recordInventoryEvent(db, {
      inventoryItemId: job.inventoryItemId,
      userId: actorUserId,
      accountId: job.accountId,
      type: "sync_conflict",
      source: "system",
      payload: { syncJobId: job.id, action: "canceled" } as Prisma.InputJsonValue,
    });
  }
  return result.count === 1;
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
  const inventoryItemId =
    typeof payload.inventoryItemId === "string"
      ? payload.inventoryItemId
      : job.inventoryItemId;
  const marketplaceListingId =
    typeof payload.marketplaceListingId === "string"
      ? payload.marketplaceListingId
      : job.marketplaceListingId;
  const soldMarketplace =
    typeof payload.soldMarketplace === "string"
      ? (payload.soldMarketplace as Marketplace)
      : null;
  const accountId = typeof payload.accountId === "string" ? payload.accountId : undefined;

  if (!inventoryItemId || !marketplaceListingId) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The delist job payload was incomplete.",
    });
  }

  // Scope by account when the queueing path provided it; legacy jobs remain
  // owner-scoped. This keeps shared-account delists from becoming false no-ops.
  const listing = await db.marketplaceListing.findFirst({
    where: {
      id: marketplaceListingId,
      inventoryItem: listingOwnerScope(job.userId, accountId),
    },
    select: {
      id: true,
      marketplace: true,
      status: true,
      externalUrl: true,
      inventoryItem: { select: { accountId: true, sellerId: true, productName: true } },
    },
  });

  // Nothing to do: listing gone, or already in a terminal (delisted/ended/sold)
  // state. Treat as success so the job never loops.
  if (!listing || TERMINAL_LISTING_STATUSES.has(listing.status)) {
    return finalizeSucceeded(db, job.id);
  }

  // Never delist the marketplace the sale came from.
  if (soldMarketplace && listing.marketplace === soldMarketplace) {
    return finalizeSkip(
      db,
      job.id,
      "SOLD_SOURCE",
      "Listing is on the sold-source marketplace; not delisting.",
    );
  }

  if (listing.marketplace === "ebay") {
    return execEbayDelist(db, job, inventoryItemId, listing, soldMarketplace, deps);
  }

  if (listing.marketplace === "stockx") {
    return execStockXDelist(db, job, inventoryItemId, listing, soldMarketplace, deps);
  }

  // Non-adapter marketplaces are defensive only: these are normally enqueued as
  // needs_review and never claimed. NEVER fake a delist for a marketplace with
  // no adapter.
  await parkForManualDelist(db, job, listing, soldMarketplace, false);
  return finalizeNeedsReview(db, job.id, "MANUAL_DELIST_REQUIRED");
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
    return finalizeNeedsReviewOrFailed(db, job, error);
  }

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

  return finalizeSucceeded(db, job.id);
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
  try {
    await stockxDelist(db as unknown as MarketplaceDelistHandlerPrismaLike, {
      userId: job.userId,
      accountId: listing.inventoryItem.accountId ?? undefined,
      inventoryItemId,
      confirmLiveDelist: true,
    });
  } catch (error) {
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
    return finalizeNeedsReviewOrFailed(db, job, error);
  }

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

  return finalizeSucceeded(db, job.id);
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
  const inventoryItemId =
    typeof payload.inventoryItemId === "string"
      ? payload.inventoryItemId
      : job.inventoryItemId;
  const marketplaceListingId =
    typeof payload.marketplaceListingId === "string"
      ? payload.marketplaceListingId
      : job.marketplaceListingId;
  const accountId = typeof payload.accountId === "string" ? payload.accountId : undefined;

  if (!inventoryItemId || !marketplaceListingId) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The status-sync job payload was incomplete.",
    });
  }

  const listing = await db.marketplaceListing.findFirst({
    where: {
      id: marketplaceListingId,
      inventoryItem: listingOwnerScope(job.userId, accountId),
    },
    select: {
      id: true,
      marketplace: true,
      status: true,
      externalUrl: true,
      inventoryItem: { select: { accountId: true, sellerId: true, productName: true } },
    },
  });

  if (!listing || TERMINAL_LISTING_STATUSES.has(listing.status)) {
    return finalizeSucceeded(db, job.id);
  }

  if (listing.marketplace !== "stockx") {
    return finalizeSkip(
      db,
      job.id,
      "NOT_IMPLEMENTED",
      `No status-sync executor implemented for marketplace "${listing.marketplace}".`,
    );
  }

  const stockxStatusSync = deps.stockxStatusSync ?? syncStockXListingStatus;
  try {
    await stockxStatusSync(db as unknown as StockXStatusSyncPrismaLike, {
      userId: job.userId,
      accountId: listing.inventoryItem.accountId ?? accountId,
      inventoryItemId,
      marketplaceListingId,
    });
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

  return finalizeSucceeded(db, job.id);
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
  const userId =
    typeof payload.userId === "string" ? payload.userId : job.userId;
  const kind = typeof payload.kind === "string" ? payload.kind : null;
  const title = typeof payload.title === "string" ? payload.title : null;
  const body = typeof payload.body === "string" ? payload.body : null;
  const inventoryItemId =
    typeof payload.inventoryItemId === "string"
      ? payload.inventoryItemId
      : job.inventoryItemId;

  if (!kind || !title || !body) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The notification job payload was incomplete.",
    });
  }

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

  return finalizeSucceeded(db, job.id);
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
  const userId =
    typeof payload.userId === "string" ? payload.userId : job.userId;
  const type = typeof payload.type === "string" ? payload.type : null;
  const title = typeof payload.title === "string" ? payload.title : null;
  const description =
    typeof payload.description === "string" ? payload.description : null;

  if (!type || !title || !description) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The review-task job payload was incomplete.",
    });
  }

  // createReviewTask already dedupes open tasks by type+inventoryItemId+marketplace.
  await createReviewTask(db, {
    userId,
    accountId: job.accountId,
    type: type as Parameters<typeof createReviewTask>[1]["type"],
    inventoryItemId:
      typeof payload.inventoryItemId === "string"
        ? payload.inventoryItemId
        : job.inventoryItemId,
    marketplace:
      typeof payload.marketplace === "string"
        ? (payload.marketplace as Marketplace)
        : null,
    title,
    description,
    payload: (payload.payload ?? {}) as Prisma.InputJsonValue,
  });
  return finalizeSucceeded(db, job.id);
}

// --- Terminal-status helpers -------------------------------------------------

async function finalizeSucceeded(
  db: SyncWorkerPrismaLike,
  jobId: string,
): Promise<RunSummary> {
  await db.syncJob.update({
    where: { id: jobId },
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
  return { status: "succeeded" };
}

async function finalizeSkip(
  db: SyncWorkerPrismaLike,
  jobId: string,
  code: string,
  message: string,
): Promise<RunSummary> {
  await db.syncJob.update({
    where: { id: jobId },
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
  return { status: "skipped" };
}

async function finalizeNeedsReview(
  db: SyncWorkerPrismaLike,
  jobId: string,
  code: string,
): Promise<RunSummary> {
  await db.syncJob.update({
    where: { id: jobId },
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
  return { status: "needs_review" };
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
    await db.syncJob.update({
      where: { id: job.id },
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
    return { status: "retry_wait" };
  }
  await db.syncJob.update({
    where: { id: job.id },
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
  return { status: "failed" };
}

// A retryable external failure parks in retry_wait with exponential backoff.
// The review task/notification created by the caller remains visible while the
// automatic retry proceeds. Attempt exhaustion becomes terminal failed.
async function finalizeNeedsReviewOrFailed(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  error?: unknown,
): Promise<RunSummary> {
  const exhausted = job.attempts >= job.maxAttempts;
  const message = safeFailureText(
    error instanceof Error ? error.message : undefined,
    "The delist could not be completed automatically.",
  );
  if (exhausted) {
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorCode: "DELIST_FAILED",
        errorMessage: message,
        runAfter: null,
        lockedAt: null,
        leaseOwner: null,
        retryClass: "attempts_exhausted",
        completedAt: new Date(),
      },
    });
    return { status: "failed" };
  }
  const status = failureStatus(error);
  if (status !== null && status !== 408 && status !== 429 && status < 500) {
    return finalizeNeedsReview(db, job.id, "DELIST_MANUAL_REVIEW_REQUIRED");
  }
  await db.syncJob.update({
    where: { id: job.id },
    data: {
      status: "retry_wait",
      errorCode: "DELIST_RETRY_WAIT",
      errorMessage: message,
      runAfter: new Date(Date.now() + retryDelayMs(job.attempts, job.id)),
      lockedAt: null,
      leaseOwner: null,
      retryClass: "transient_external",
      completedAt: null,
    },
  });
  return { status: "retry_wait" };
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
  db: SyncJobControlPrismaLike,
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
    },
  });
}
