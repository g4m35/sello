import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { isStockXApiConfigured, isStockXListingEnabled } from "@/lib/marketplace/adapters/stockx/config";
import { STOCKX_ENVIRONMENT } from "@/lib/marketplace/adapters/stockx/types";
import { enqueueSyncJob, type SyncJobPrismaLike } from "./sync-jobs";

export const STOCKX_MONITOR_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 25;
const KEY_PREFIX = "stockx-status-monitor-v1";
const PENDING_STATUSES = ["queued", "running", "retry_wait", "needs_review"] as const;
type Candidate = { id: string; inventoryItemId: string; accountId: string; userId: string };
type Transaction = Pick<Prisma.TransactionClient, "$queryRaw" | "syncJob"> & SyncJobPrismaLike;
type Db = { $transaction<T>(run: (tx: Transaction) => Promise<T>, options: { timeout: number; maxWait: number }): Promise<T> };

export const stockxMonitorDeps = {
  enabled: () => isStockXApiConfigured() && isStockXListingEnabled(),
  now: () => Date.now(),
};

export function stockxMonitorKey(listingId: string, window: number) {
  return `${KEY_PREFIX}:${listingId}:${window}`;
}

/** Records intent only. The existing worker rechecks ownership, membership,
 * entitlement, configuration, connection and authoritative item state before
 * reading StockX. A queued check is never counted as a successful sale check. */
export async function enqueueStockXStatusChecks(
  db: Db = getPrisma(),
  deps = stockxMonitorDeps,
  deadline = Date.now() + 10_000,
) {
  const summary = { scheduled: 0, skipped: 0, disabled: false, deadlineReached: false };
  if (!deps.enabled()) return { ...summary, disabled: true };
  const now = deps.now();
  if (now >= deadline) return { ...summary, deadlineReached: true };
  const dueBefore = new Date(now - STOCKX_MONITOR_INTERVAL_MS);
  const window = Math.floor(now / STOCKX_MONITOR_INTERVAL_MS);
  try {
    return await db.$transaction(async (tx) => {
      // Prisma has no listing -> SyncJob relation. Parameterized SQL keeps the
      // eligibility/exclusion and LIMIT in the database; filtering a fixed page
      // in memory would let old parked listings starve every newer listing.
      const candidates = await tx.$queryRaw<Candidate[]>(Prisma.sql`
        SELECT l.id, l."inventoryItemId", i."accountId", c."userId"
        FROM "MarketplaceListing" l
        JOIN "InventoryItem" i ON i.id = l."inventoryItemId"
        JOIN "MarketplaceConnection" c ON c."accountId" = i."accountId"
          AND c.marketplace = 'stockx' AND c.environment = ${STOCKX_ENVIRONMENT}
        LEFT JOIN LATERAL (
          SELECT j.status FROM "SyncJob" j
          WHERE j."marketplaceListingId" = l.id AND j."accountId" = i."accountId"
            AND j.type = 'detect_status'
          ORDER BY j."updatedAt" DESC, j.id DESC LIMIT 1
        ) latest ON true
        WHERE l.marketplace = 'stockx' AND l.environment = ${STOCKX_ENVIRONMENT}
          AND l.status = 'LISTED' AND NULLIF(BTRIM(l."externalListingId"), '') IS NOT NULL
          AND i.status NOT IN ('SOLD', 'DELISTING', 'DELISTED', 'ARCHIVED')
          AND i."quantityAvailable" > 0
          AND (l."lastSyncAt" IS NULL OR l."lastSyncAt" <= ${dueBefore})
          AND (latest.status IS NULL OR latest.status = 'succeeded')
          AND NOT EXISTS (
            SELECT 1 FROM "SyncJob" j WHERE j."marketplaceListingId" = l.id
              AND j."accountId" = i."accountId" AND j.type = 'detect_status'
              AND j.status IN ('queued', 'running', 'retry_wait', 'needs_review')
          )
          AND NOT EXISTS (
            SELECT 1 FROM "SyncJob" j WHERE j."idempotencyKey" =
              ${KEY_PREFIX} || ':' || l.id::text || ':' || ${String(window)}
          )
        ORDER BY l."lastSyncAt" ASC NULLS FIRST, l."createdAt" ASC, l.id ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF l SKIP LOCKED
      `);
      for (const listing of candidates) {
        if (deps.now() >= deadline) {
          summary.deadlineReached = true;
          break;
        }
        const scope = { marketplaceListingId: listing.id, accountId: listing.accountId, type: "detect_status" as const };
        // A second statement gets a fresh READ COMMITTED snapshot after taking
        // the listing lock, closing the race across adjacent polling windows.
        const latest = await tx.syncJob.findFirst({
          where: scope, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { status: true },
        });
        const pending = await tx.syncJob.findFirst({
          where: { ...scope, status: { in: [...PENDING_STATUSES] } }, select: { id: true },
        });
        if (pending || (latest && latest.status !== "succeeded")) {
          summary.skipped++;
          continue;
        }
        const job = await enqueueSyncJob(tx, {
          userId: listing.userId,
          accountId: listing.accountId,
          inventoryItemId: listing.inventoryItemId,
          marketplaceListingId: listing.id,
          type: "detect_status",
          idempotencyKey: stockxMonitorKey(listing.id, window),
          payload: { source: KEY_PREFIX },
        });
        if (job.status === "queued") summary.scheduled++;
        else summary.skipped++;
      }
      return summary;
    }, { timeout: Math.max(1, Math.min(10_000, deadline - now)), maxWait: 1_000 });
  } catch {
    // The transaction rolls back every enqueue on failure. Do not return a
    // healthy zero or leak database/provider text to worker responses.
    throw new AppError("StockX sale checks could not be scheduled. The next worker run will try scheduling again.", 503);
  }
}
