import { z } from "zod";

import { MAX_LISTING_PHOTOS, MAX_PHOTO_BYTES } from "@/lib/uploads";

export const MAX_BULK_ITEMS = 250;
export const MAX_BULK_PHOTOS = MAX_BULK_ITEMS * MAX_LISTING_PHOTOS;

export const BULK_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const originalNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Photo names cannot contain control characters.");

const bulkPhotoDeclarationSchema = z
  .object({
    uploadId: z.string().uuid(),
    originalName: originalNameSchema,
    mimeType: z.enum(BULK_PHOTO_MIME_TYPES),
    sizeBytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  })
  .strict();

function uniqueUploadIds(photos: Array<{ uploadId: string }>): boolean {
  return new Set(photos.map((photo) => photo.uploadId)).size === photos.length;
}

export const bulkPhotoUploadRequestSchema = z
  .object({
    photos: z.array(bulkPhotoDeclarationSchema).min(1).max(MAX_BULK_PHOTOS),
  })
  .strict()
  .refine((value) => uniqueUploadIds(value.photos), {
    message: "Each photo upload id must be unique.",
    path: ["photos"],
  });

export const bulkPhotoRegistrationSchema = z
  .object({
    photos: z
      .array(
        bulkPhotoDeclarationSchema.extend({
          storagePath: z.string().min(1).max(512),
        }),
      )
      .min(1)
      .max(MAX_BULK_PHOTOS),
  })
  .strict()
  .refine((value) => uniqueUploadIds(value.photos), {
    message: "Each photo upload id must be unique.",
    path: ["photos"],
  });

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
export type BulkPhotoUploadInput = z.infer<typeof bulkPhotoUploadRequestSchema>["photos"][number];
export type BulkPhotoRegistrationInput = z.infer<typeof bulkPhotoRegistrationSchema>["photos"][number];
