import { AppError } from "@/lib/errors";

export const BULK_BATCH_STATUSES = [
  "created",
  "uploading",
  "processing",
  "needs_review",
  "ready",
  "partially_failed",
  "failed",
  "canceled",
] as const;

export const BULK_ITEM_STATUSES = [
  "uploaded",
  "grouping",
  "ready_for_generation",
  "generating",
  "needs_review",
  "listing_ready",
  "failed",
  "canceled",
] as const;

export type BulkBatchStatusValue = (typeof BULK_BATCH_STATUSES)[number];
export type BulkItemStatusValue = (typeof BULK_ITEM_STATUSES)[number];

const ITEM_TRANSITIONS: Record<BulkItemStatusValue, readonly BulkItemStatusValue[]> = {
  uploaded: ["grouping", "canceled"],
  grouping: ["ready_for_generation", "canceled"],
  ready_for_generation: ["grouping", "generating", "canceled"],
  generating: ["needs_review", "listing_ready", "failed", "canceled"],
  needs_review: ["generating", "canceled"],
  listing_ready: [],
  failed: ["generating", "canceled"],
  canceled: [],
};

export function assertBulkItemTransition(
  from: BulkItemStatusValue,
  to: BulkItemStatusValue,
): void {
  if (!ITEM_TRANSITIONS[from].includes(to)) {
    throw new AppError(
      `Bulk item cannot move from ${from} to ${to}.`,
      409,
      "BULK_ITEM_INVALID_TRANSITION",
    );
  }
}

export type BulkBatchSnapshot = {
  status: BulkBatchStatusValue;
  totalItems: number;
  processedItems: number;
  needsReviewItems: number;
  listingReadyItems: number;
  failedItems: number;
  canceledItems: number;
};

export function summarizeBulkItems(
  items: readonly { status: BulkItemStatusValue }[],
): BulkBatchSnapshot {
  const count = (status: BulkItemStatusValue) =>
    items.filter((item) => item.status === status).length;
  const totalItems = items.length;
  const needsReviewItems = count("needs_review");
  const listingReadyItems = count("listing_ready");
  const failedItems = count("failed");
  const canceledItems = count("canceled");
  const processedItems =
    needsReviewItems + listingReadyItems + failedItems + canceledItems;

  let status: BulkBatchStatusValue;
  if (totalItems === 0) {
    status = "created";
  } else if (canceledItems === totalItems) {
    status = "canceled";
  } else if (failedItems === totalItems) {
    status = "failed";
  } else if (items.some((item) => item.status === "generating" || item.status === "grouping")) {
    status = "processing";
  } else if (
    (failedItems > 0 || canceledItems > 0) &&
    processedItems === totalItems
  ) {
    status = "partially_failed";
  } else if (listingReadyItems === totalItems) {
    status = "ready";
  } else {
    status = "needs_review";
  }

  return {
    status,
    totalItems,
    processedItems,
    needsReviewItems,
    listingReadyItems,
    failedItems,
    canceledItems,
  };
}
