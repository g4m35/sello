import { z } from "zod";

import { MAX_LISTING_PHOTOS } from "@/lib/uploads";

export const MAX_BULK_ITEMS = 250;
export const MAX_BULK_PHOTOS = MAX_BULK_ITEMS * MAX_LISTING_PHOTOS;

export const createBulkBatchSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    expectedItems: z.number().int().min(1).max(MAX_BULK_ITEMS).optional(),
  })
  .strict();

export const bulkGroupingSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            photoIds: z
              .array(z.string().uuid())
              .min(1)
              .max(MAX_LISTING_PHOTOS),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BULK_ITEMS),
  })
  .strict();

export type BulkPhotoGroupInput = z.infer<typeof bulkGroupingSchema>["groups"][number];
