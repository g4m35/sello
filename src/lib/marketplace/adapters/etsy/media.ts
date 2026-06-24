import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

import type { EtsyListImagesUpload } from "./client";

export type EtsyPhotoRef = {
  storageBucket: string;
  storagePath: string;
  originalName: string;
  position: number;
};

// Downloads an item's photos from storage into Etsy upload payloads. Etsy image
// rank is 1-based and follows photo position. A photo that fails to download is
// skipped (the publish reports the gap) rather than aborting the whole listing.
export async function loadEtsyImagesForItem(
  photos: EtsyPhotoRef[],
): Promise<EtsyListImagesUpload[]> {
  const supabase = createSupabaseServiceClient();
  const ordered = [...photos].sort((a, b) => a.position - b.position);
  const images: EtsyListImagesUpload[] = [];

  for (const photo of ordered) {
    const { data, error } = await supabase.storage
      .from(photo.storageBucket)
      .download(photo.storagePath);
    if (error || !data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    images.push({
      data: bytes,
      fileName: photo.originalName,
      rank: photo.position + 1,
    });
  }

  return images;
}
