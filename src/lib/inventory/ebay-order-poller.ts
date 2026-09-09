import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { getEbayConfig, getEbayEnvironment } from "@/lib/marketplace/adapters/ebay/config";
import { EbaySandboxClient, getUsableEbayAccessToken } from "@/lib/marketplace/adapters/ebay/client";
import { EBAY_FULFILLMENT_SCOPE, type EbayFulfillmentOrder } from "@/lib/marketplace/adapters/ebay/types";
import { reconcileEbaySoldSignal, type EbaySoldSignal } from "./ebay-sold-reconciliation";
import { createNotification } from "./notifications";
import { listingJobDeps } from "@/lib/automation/listing-job";
import { AppError, logUnexpectedError } from "@/lib/errors";

const QUEUE = "ebay-order-poll-v1";
const CursorSchema = z.object({ since: z.string().datetime(), until: z.string().datetime().nullable(), pendingEnds: z.array(z.string().datetime()).max(64) });

// Offset pagination is unsafe on a changing last-modified search. Only consume
// complete single-page windows. Split oversized windows and retain every end.
export function advanceOrderWindow(cursor: z.infer<typeof CursorSchema>, until: string, hasMore: boolean) {
  if (hasMore) {
    const start = new Date(cursor.since).getTime();
    const end = new Date(until).getTime();
    if (end - start <= 1000 || cursor.pendingEnds.length >= 64) throw new AppError("Too many orders share one timestamp. Review eBay orders manually while sale monitoring catches up.", 409);
    return { since: cursor.since, until: new Date(Math.floor((start + end) / 2)).toISOString(), pendingEnds: [until, ...cursor.pendingEnds] };
  }
  if (cursor.pendingEnds.length) return { since: until, until: cursor.pendingEnds[0], pendingEnds: cursor.pendingEnds.slice(1) };
  return { since: new Date(new Date(until).getTime() - 120_000).toISOString(), until: null, pendingEnds: [] };
}
type Db = ReturnType<typeof getPrisma>;

export function orderSignals(order: EbayFulfillmentOrder, scope: Pick<EbaySoldSignal, "accountId" | "actorUserId" | "environment">): EbaySoldSignal[] {
  if (!order.orderId) return [];
  return (order.lineItems ?? []).flatMap((line) => {
    if (!line.lineItemId || !line.legacyItemId) return [];
    const date = order.lastModifiedDate ? new Date(order.lastModifiedDate) : null;
    const refunded = order.paymentSummary?.refunds?.some((r) => r.refundStatus !== "FAILED");
    return [{ ...scope, externalEventId: `${order.orderId}:${line.lineItemId}:${order.lastModifiedDate ?? order.creationDate ?? "initial"}`,
      externalOrderId: order.orderId!, externalLineItemId: line.lineItemId,
      externalListingId: line.legacyItemId, paymentStatus: refunded ? "PARTIALLY_REFUNDED" : order.orderPaymentStatus ?? "UNKNOWN",
      fulfillmentStatus: order.orderFulfillmentStatus ?? "UNKNOWN", cancelState: order.cancelStatus?.cancelState ?? "UNKNOWN",
      quantity: line.quantity ?? 0, occurredAt: date && Number.isFinite(date.getTime()) ? date : null, verifiedSource: true }];
  });
}

export const orderPollerDeps = {
  resolveUser: listingJobDeps.resolveUser,
  entitlements: listingJobDeps.entitlements,
  accessToken: getUsableEbayAccessToken,
  client: (token: string, marketplaceId: "EBAY_US", environment: "sandbox" | "production", scopes: string[]) => new EbaySandboxClient(token, marketplaceId, fetch, environment, scopes),
  reconcile: reconcileEbaySoldSignal,
  notify: createNotification,
};

// Claims are per connection; completed windows advance only after reconciliation.
export async function pollEbayOrders(db: Db = getPrisma(), deps = orderPollerDeps, deadline = Date.now() + 60_000) {
  const environment = getEbayEnvironment();
  const connections = await db.marketplaceConnection.findMany({ where: { marketplace: "ebay", environment }, select: { id: true, accountId: true, userId: true } });
  const summary = { checked: 0, deferred: 0, failed: 0 };
  if (!connections.length) return summary;
  const now = new Date();
  await db.jobLog.createMany({ skipDuplicates: true, data: connections.map((c) => ({
    id: c.id, queueName: QUEUE, jobName: "poll-orders", status: "QUEUED", payload: { since: new Date(now.getTime() - 7 * 86400_000).toISOString(), until: null, pendingEnds: [] },
  })) });
  await db.jobLog.updateMany({ where: { queueName: QUEUE, status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, data: { status: "QUEUED" } });
  const jobs = await db.jobLog.findMany({ where: { id: { in: connections.map((c) => c.id) }, queueName: QUEUE, status: { not: "RUNNING" } }, orderBy: { updatedAt: "asc" }, take: 5 });
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    const lease = new Date();
    const claimed = await db.jobLog.updateMany({ where: { id: job.id, status: job.status, updatedAt: job.updatedAt }, data: { status: "RUNNING", updatedAt: lease } });
    if (claimed.count !== 1) continue;
    try {
      const connection = await db.marketplaceConnection.findUnique({ where: { id: job.id } });
      if (!connection || connection.marketplace !== "ebay" || connection.environment !== environment) throw new AppError("Reconnect eBay to resume sale monitoring.", 409);
      const user = await deps.resolveUser(connection.userId);
      const access = await deps.entitlements(user, db);
      if (user.id !== connection.userId || access.account.id !== connection.accountId || !access.access.ebayDelist) throw new AppError("Sale monitoring is unavailable for this account. Check eBay access in Settings.", 403);
      if (!connection.scopes.includes(EBAY_FULFILLMENT_SCOPE)) throw new AppError("Reconnect eBay to grant permission to read sales.", 409);
      const cursor = CursorSchema.parse(job.payload);
      const until = cursor.until ?? now.toISOString();
      const config = getEbayConfig();
      const token = await deps.accessToken(db, connection, config);
      const client = deps.client(token, config.marketplaceId, environment, connection.scopes);
      const page = await client.getOrdersModifiedSince(new Date(cursor.since), { limit: 50, offset: 0, modifiedUntil: new Date(until) });
      // A full page without a trustworthy next indicator is also split, so a
      // provider truncation cannot silently turn into a completed window.
      const hasMore = Boolean(page.next) || page.orders.length >= 50;
      const nextCursor = advanceOrderWindow(cursor, until, hasMore);
      if (!hasMore) {
        for (const order of page.orders) {
          for (const signal of orderSignals(order, { accountId: connection.accountId, actorUserId: user.id, environment })) {
            const owned = await db.marketplaceListing.findFirst({ where: { marketplace: "ebay", environment, externalListingId: signal.externalListingId, inventoryItem: { accountId: connection.accountId } }, select: { id: true } });
            if (owned) {
              const result = await deps.reconcile(db, signal);
              if (result.outcome === "duplicate" && result.priorOutcome === null) throw new AppError("Sale reconciliation is still running. This window will be checked again.", 409);
            }
          }
        }
      }
      const deferred = nextCursor.until !== null;
      const saved = await db.jobLog.updateMany({ where: { id: job.id, status: "RUNNING", updatedAt: lease }, data: { status: deferred ? "QUEUED" : "SUCCEEDED", payload: nextCursor, errorMessage: null, result: { message: deferred ? "Checking remaining eBay orders…" : "eBay sales checked.", checkedAt: now.toISOString() } } });
      if (saved.count === 1) summary[deferred ? "deferred" : "checked"]++;
    } catch (error) {
      logUnexpectedError("ebay_order_poller", error);
      const message = error instanceof AppError ? error.message : "eBay sale monitoring needs attention. Check your connection in Settings and review recent eBay orders.";
      const saved = await db.jobLog.updateMany({ where: { id: job.id, status: "RUNNING", updatedAt: lease }, data: { status: "FAILED", errorMessage: message } });
      if (saved.count !== 1) continue;
      summary.failed++;
      const scope = connections.find((connection) => connection.id === job.id)!;
      await deps.notify(db, { userId: scope.userId, accountId: scope.accountId, kind: "sync_conflict", title: "eBay sale monitoring needs attention", body: message, dedupeKey: `ebay-monitor:${scope.id}:${now.toISOString().slice(0, 10)}` });
    }
  }
  return summary;
}
