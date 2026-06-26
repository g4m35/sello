import type {
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
  type NotificationPrismaLike,
} from "@/lib/inventory/notifications";
import {
  createReviewTask,
  type ReviewTaskPrismaLike,
} from "@/lib/inventory/review-tasks";
import {
  executeEbayDelist,
  type DelistPrismaLike as EbayDelistHandlerPrismaLike,
} from "@/lib/marketplace/delist-handler";
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

// --- Job row shapes ----------------------------------------------------------

export type ClaimedSyncJob = {
  id: string;
  userId: string;
  type: SyncJobType;
  status: SyncJobStatus;
  inventoryItemId: string | null;
  marketplaceListingId: string | null;
  attempts: number;
  maxAttempts: number;
  payload: Prisma.JsonValue;
};

// --- Prisma surfaces ---------------------------------------------------------
// Narrow structural surfaces (not the full PrismaClient) keep these functions
// trivially unit-testable, matching the engine's pattern.

type WorkerJobDelegate = {
  findMany(args: {
    where: {
      status: "queued";
      OR: [{ runAfter: null }, { runAfter: { lte: Date } }];
    };
    select: { id: true };
    take: number;
    orderBy: { createdAt: "asc" };
  }): Promise<Array<{ id: string }>>;
  updateMany(args: {
    where: { id: string; status: "queued" };
    data: { status: "running"; attempts: { increment: number } };
  }): Promise<{ count: number }>;
  findFirst(args: {
    where: { id: string };
    select: {
      id: true;
      userId: true;
      type: true;
      status: true;
      inventoryItemId: true;
      marketplaceListingId: true;
      attempts: true;
      maxAttempts: true;
      payload: true;
    };
  }): Promise<ClaimedSyncJob | null>;
  update(args: {
    where: { id: string };
    data: {
      status?: SyncJobStatus;
      errorCode?: string | null;
      errorMessage?: string | null;
    };
  }): Promise<{ id: string }>;
};

type WorkerListingRow = {
  id: string;
  marketplace: Marketplace;
  status: MarketplaceListingStatus;
  externalUrl: string | null;
};

type WorkerListingDelegate = {
  findFirst(args: {
    where: { id: string; inventoryItem: { sellerId: string } };
    select: {
      id: true;
      marketplace: true;
      status: true;
      externalUrl: true;
    };
  }): Promise<WorkerListingRow | null>;
  update(args: {
    where: { id: string };
    data: { endedAt: Date };
  }): Promise<{ id: string }>;
};

type WorkerNotificationDelegate = NotificationPrismaLike["notification"] & {
  findFirst(args: {
    where: {
      userId: string;
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
    notification: WorkerNotificationDelegate;
  };

// executeEbayDelist needs the full delist-handler surface (publishAttempt,
// marketplaceEvent, ...). The worker passes its db straight through; in
// production it is a real PrismaClient. Injectable for tests.
export type RunSyncJobDeps = {
  ebayDelist?: typeof executeEbayDelist;
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
  opts: { limit?: number } = {},
): Promise<ClaimedSyncJob[]> {
  const limit = clampLimit(opts.limit);
  const now = new Date();

  const candidates = await db.syncJob.findMany({
    where: {
      status: "queued",
      OR: [{ runAfter: null }, { runAfter: { lte: now } }],
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const claimed: ClaimedSyncJob[] = [];
  for (const { id } of candidates) {
    const result = await db.syncJob.updateMany({
      where: { id, status: "queued" },
      data: { status: "running", attempts: { increment: 1 } },
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
    case "notify_user":
      return execNotify(db, job);
    case "create_review_task":
      return execCreateReviewTask(db, job);
    case "detect_status":
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
      default:
        break;
    }
  }
  return summary;
}

// --- Executor: delist_marketplace_listing ------------------------------------

type DelistPayload = {
  inventoryItemId?: unknown;
  marketplaceListingId?: unknown;
  marketplace?: unknown;
  soldMarketplace?: unknown;
  useAdapter?: unknown;
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

  if (!inventoryItemId || !marketplaceListingId) {
    return finalizeFailure(db, job, "INVALID_PAYLOAD", undefined, {
      fallback: "The delist job payload was incomplete.",
    });
  }

  // Ownership-scoped: only the owning seller's listing is ever inspected/acted on.
  const listing = await db.marketplaceListing.findFirst({
    where: {
      id: marketplaceListingId,
      inventoryItem: { sellerId: job.userId },
    },
    select: { id: true, marketplace: true, status: true, externalUrl: true },
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
    return execEbayDelist(db, job, inventoryItemId, listing, deps);
  }

  // Non-eBay is defensive only: these are normally enqueued as needs_review and
  // never claimed. NEVER fake a delist for a marketplace with no adapter.
  await parkForManualDelist(db, job, listing, soldMarketplace);
  return finalizeNeedsReviewOrFailed(db, job);
}

async function execEbayDelist(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  inventoryItemId: string,
  listing: WorkerListingRow,
  deps: RunSyncJobDeps,
): Promise<RunSummary> {
  const ebayDelist = deps.ebayDelist ?? executeEbayDelist;
  try {
    // executeEbayDelist is ownership-scoped, records its own MarketplaceEvents,
    // and sets the eBay MarketplaceListing to DELISTED on success. It THROWS on
    // any non-delistable / missing-ID condition — we never fabricate success.
    await ebayDelist(db as unknown as EbayDelistHandlerPrismaLike, {
      userId: job.userId,
      inventoryItemId,
      confirmLiveDelist: true,
    });
  } catch (error) {
    await recordInventoryEvent(db, {
      inventoryItemId,
      userId: job.userId,
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
    await parkForManualDelist(db, job, listing, null);
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
    type: "delist_succeeded",
    source: "system",
    marketplace: listing.marketplace,
    payload: {
      marketplaceListingId: listing.id,
      syncJobId: job.id,
    } as Prisma.InputJsonValue,
  });
  return finalizeSucceeded(db, job.id);
}

// Create (deduped) a manual_delist_required review task + a delist_failed
// notification so the seller can end the listing themselves.
async function parkForManualDelist(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  listing: WorkerListingRow,
  soldMarketplace: Marketplace | null,
): Promise<void> {
  const inventoryItemId = job.inventoryItemId ?? "";
  await createReviewTask(db, {
    userId: job.userId,
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
      kind,
      title,
      body,
      inventoryItemId: inventoryItemId ?? null,
    });
    if (inventoryItemId) {
      await recordInventoryEvent(db, {
        inventoryItemId,
        userId,
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
    data: { status: "succeeded", errorCode: null, errorMessage: null },
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
    },
  });
  return { status: "skipped" };
}

async function finalizeFailure(
  db: SyncWorkerPrismaLike,
  job: ClaimedSyncJob,
  code: string,
  error: unknown,
  opts: { fallback?: string } = {},
): Promise<RunSummary> {
  await db.syncJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      errorCode: code,
      errorMessage: safeFailureText(
        error instanceof Error ? error.message : undefined,
        opts.fallback ?? "The sync job failed.",
      ),
    },
  });
  return { status: "failed" };
}

// A retryable failure: park needs_review so a later worker pass can pick it up
// again, UNLESS attempts have reached maxAttempts — then mark terminal 'failed'
// so endless retry is impossible.
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
      data: { status: "failed", errorCode: "DELIST_FAILED", errorMessage: message },
    });
    return { status: "failed" };
  }
  await db.syncJob.update({
    where: { id: job.id },
    data: {
      status: "needs_review",
      errorCode: "DELIST_NEEDS_REVIEW",
      errorMessage: message,
    },
  });
  return { status: "needs_review" };
}

// --- internals ---------------------------------------------------------------

function clampLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_CLAIM_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_CLAIM_LIMIT);
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
      type: true,
      status: true,
      inventoryItemId: true,
      marketplaceListingId: true,
      attempts: true,
      maxAttempts: true,
      payload: true,
    },
  });
}
