import { Prisma } from "@/generated/prisma/client";
import { createReviewTask } from "@/lib/inventory/review-tasks";

export const listingReviewKey = (jobId: string) => `listing-automation:${jobId}`;

export async function createListingAutomationReview(tx: Prisma.TransactionClient, job: { id: string; inventoryItemId: string | null }, message: string) {
  if (!job.inventoryItemId) return;
  // Derive ownership from the inventory row, never from a potentially invalid
  // job payload. Deleted inventory has no seller action left to surface.
  const item = await tx.inventoryItem.findFirst({ where: { id: job.inventoryItemId }, select: { accountId: true, sellerId: true } });
  if (!item?.accountId) return;
  await createReviewTask(tx, {
    accountId: item.accountId, userId: item.sellerId, inventoryItemId: job.inventoryItemId,
    type: "sync_conflict", title: "Listing automation needs attention", description: message,
    dedupeKey: listingReviewKey(job.id), payload: { listingAutomationJobId: job.id },
  });
}
