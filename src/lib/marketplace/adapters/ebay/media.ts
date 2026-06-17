type EbayEnv = Record<string, string | undefined>;

export type EbayStoredPhoto = {
  storageBucket: string;
  storagePath: string;
};

export type EbayResolvedPhoto = {
  url: string | null;
};

export const ebayPublicPhotoMissingCode = "ebay_public_photo";

export function resolveEbayPhotoUrls(
  photos: EbayStoredPhoto[],
  env: EbayEnv,
): { photos: EbayResolvedPhoto[]; missing: string[] } {
  if (photos.length === 0) {
    return { photos: [], missing: [] };
  }

  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicBucket = env.EBAY_PUBLIC_IMAGE_BUCKET?.trim();
  if (!base || !publicBucket) {
    return { photos: [], missing: [ebayPublicPhotoMissingCode] };
  }

  const root = base.replace(/\/$/, "");
  const resolved = photos
    .filter((photo) => photo.storageBucket === publicBucket)
    .filter((photo) => photo.storagePath.trim().length > 0)
    .map((photo) => ({
      url: `${root}/storage/v1/object/public/${encodeURIComponent(
        photo.storageBucket,
      )}/${encodeStoragePath(photo.storagePath)}`,
    }));

  if (resolved.length === 0) {
    return { photos: [], missing: [ebayPublicPhotoMissingCode] };
  }

  return { photos: resolved, missing: [] };
}

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}
