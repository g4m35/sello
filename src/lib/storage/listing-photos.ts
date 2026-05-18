import { randomUUID } from "node:crypto";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getRequiredEnv } from "@/lib/errors";

const EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type PreparedListingPhoto = {
  file: File;
  buffer: Buffer;
  base64: string;
  mimeType: string;
  originalName: string;
  position: number;
};

export type UploadedListingPhoto = {
  bucket: string;
  path: string;
  mimeType: string;
  originalName: string;
  position: number;
};

export async function prepareListingPhotos(files: File[]) {
  return Promise.all(
    files.map(async (file, index): Promise<PreparedListingPhoto> => {
      const buffer = Buffer.from(await file.arrayBuffer());

      return {
        file,
        buffer,
        base64: buffer.toString("base64"),
        mimeType: file.type,
        originalName: file.name,
        position: index,
      };
    }),
  );
}

export async function uploadListingPhotos({
  sellerId,
  inventoryItemId,
  photos,
}: {
  sellerId: string;
  inventoryItemId: string;
  photos: PreparedListingPhoto[];
}): Promise<UploadedListingPhoto[]> {
  const supabase = createSupabaseServiceClient();
  const bucket = getRequiredEnv("SUPABASE_STORAGE_BUCKET");

  return Promise.all(
    photos.map(async (photo) => {
      const extension = EXTENSIONS_BY_MIME_TYPE[photo.mimeType] ?? "bin";
      const path = `${sellerId}/${inventoryItemId}/${photo.position}-${randomUUID()}.${extension}`;
      const { data, error } = await supabase.storage.from(bucket).upload(path, photo.buffer, {
        contentType: photo.mimeType,
        upsert: false,
      });

      if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }

      return {
        bucket,
        path: data.path,
        mimeType: photo.mimeType,
        originalName: photo.originalName,
        position: photo.position,
      };
    }),
  );
}
