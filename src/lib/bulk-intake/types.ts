import type { BulkItemStatusValue } from "./status";

export type BulkPhotoView = {
  id: string;
  originalName: string;
  mimeType: string;
  position: number;
  itemPosition: number | null;
  bulkItemId: string | null;
  url: string | null;
};

export type BulkItemView = {
  id: string;
  position: number;
  status: BulkItemStatusValue;
  inventoryItemId: string | null;
  reviewReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  generationAttempts: number;
  aiProvider: string | null;
  aiModel: string | null;
  photos: BulkPhotoView[];
};

export type BulkBatchView = {
  id: string;
  status: string;
  photoCount: number;
  totalItems: number;
  processedItems: number;
  needsReviewItems: number;
  listingReadyItems: number;
  failedItems: number;
  canceledItems: number;
  createdAt: string;
  updatedAt: string;
  photos: BulkPhotoView[];
  items: BulkItemView[];
};

export type BulkBatchSummaryView = Omit<BulkBatchView, "photos" | "items">;

export type BulkGenerationResult = {
  itemId: string;
  status: BulkItemStatusValue;
  inventoryItemId: string | null;
  reviewReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type BulkPhotoUploadGrant = {
  uploadId: string;
  bucket: string;
  path: string;
  token: string;
};
