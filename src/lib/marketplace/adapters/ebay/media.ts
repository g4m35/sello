import { randomUUID } from "node:crypto";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { EbayEnvironment } from "./types";

type EbayEnv = Record<string, string | undefined>;

export type EbayStoredPhoto = {
  id?: string;
  inventoryItemId?: string;
  storageBucket: string;
  storagePath: string;
  mimeType?: string;
  originalName?: string;
  position?: number;
};

export type EbayResolvedPhoto = {
  url: string | null;
};

export const ebayPublicPhotoMissingCode = "ebay_public_photo";

const supportedEbayImageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type MarketplaceImageRow = {
  itemPhotoId: string;
  marketplace: string;
  environment: string;
  storagePath: string;
  publicUrl: string;
  status: string;
};

export type EbayMediaPrismaLike = {
  marketplaceImage: {
    findMany(args: {
      where: {
        inventoryItemId: string;
        marketplace: "ebay";
        environment: EbayEnvironment;
        itemPhotoId?: { in: string[] };
      };
      select?: unknown;
    }): Promise<MarketplaceImageRow[]>;
    upsert(args: {
      where: {
        itemPhotoId_marketplace_environment: {
          itemPhotoId: string;
          marketplace: "ebay";
          environment: EbayEnvironment;
        };
      };
      create: {
        inventoryItemId: string;
        itemPhotoId: string;
        marketplace: "ebay";
        environment: EbayEnvironment;
        storagePath: string;
        publicUrl: string;
        status: "READY";
      };
      update: {
        storagePath: string;
        publicUrl: string;
        status: "READY";
      };
    }): Promise<MarketplaceImageRow>;
  };
};

export type EbayMediaItem = {
  id: string;
  sellerId: string;
  photos: EbayStoredPhoto[];
};

export type EbayStorageLike = {
  from(bucket: string): {
    copy(
      fromPath: string,
      toPath: string,
      options: { destinationBucket: string },
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export type EbayVisibleImageResult = {
  photos: EbayResolvedPhoto[];
  missing: string[];
  errors: string[];
};

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

export async function prepareEbayVisibleImages(
  prisma: EbayMediaPrismaLike,
  {
    userId,
    item,
    environment,
    env,
    storage,
    randomId = randomUUID,
  }: {
    userId: string;
    item: EbayMediaItem;
    environment: EbayEnvironment;
    env: EbayEnv;
    storage?: EbayStorageLike;
    randomId?: () => string;
  },
): Promise<EbayVisibleImageResult> {
  if (item.photos.length === 0) {
    return {
      photos: [],
      missing: [ebayPublicPhotoMissingCode],
      errors: ["Add at least one photo so Sello can prepare an eBay-visible listing image."],
    };
  }

  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicBucket = env.EBAY_PUBLIC_IMAGE_BUCKET?.trim();
  if (!base || !publicBucket) {
    return {
      photos: [],
      missing: [ebayPublicPhotoMissingCode],
      errors: ["eBay-visible image storage is not configured."],
    };
  }

  const photosWithIds = item.photos.filter(
    (photo): photo is EbayStoredPhoto & { id: string } =>
      typeof photo.id === "string" && photo.id.length > 0,
  );
  if (photosWithIds.length === 0) {
    return {
      photos: [],
      missing: [ebayPublicPhotoMissingCode],
      errors: ["No persisted photos are available for eBay image preparation."],
    };
  }

  const existingRows = await prisma.marketplaceImage.findMany({
    where: {
      inventoryItemId: item.id,
      marketplace: "ebay",
      environment,
      itemPhotoId: { in: photosWithIds.map((photo) => photo.id) },
    },
    select: {
      itemPhotoId: true,
      marketplace: true,
      environment: true,
      storagePath: true,
      publicUrl: true,
      status: true,
    },
  });
  const readyByPhotoId = new Map(
    existingRows
      .filter((row) => row.status === "READY" && row.publicUrl.trim().length > 0)
      .map((row) => [row.itemPhotoId, row.publicUrl]),
  );

  const prepared: EbayResolvedPhoto[] = [];
  const errors: string[] = [];

  for (const photo of photosWithIds) {
    const readyUrl = readyByPhotoId.get(photo.id);
    if (readyUrl) {
      prepared.push({ url: readyUrl });
      continue;
    }

    const copyResult = await copyDerivative({
      prisma,
      storage:
        storage ?? (createSupabaseServiceClient().storage as EbayStorageLike),
      photo,
      item,
      environment,
      publicBucket,
      base,
      randomId,
    });
    if ("error" in copyResult) {
      errors.push(copyResult.error);
      continue;
    }
    prepared.push({ url: copyResult.url });
  }

  if (errors.length > 0 || prepared.length === 0) {
    return {
      photos: [],
      missing: [ebayPublicPhotoMissingCode],
      errors,
    };
  }

  return { photos: prepared, missing: [], errors: [] };
}

async function copyDerivative({
  prisma,
  storage,
  photo,
  item,
  environment,
  publicBucket,
  base,
  randomId,
}: {
  prisma: EbayMediaPrismaLike;
  storage: EbayStorageLike;
  photo: EbayStoredPhoto & { id: string };
  item: EbayMediaItem;
  environment: EbayEnvironment;
  publicBucket: string;
  base: string;
  randomId: () => string;
}): Promise<{ url: string } | { error: string }> {
  if (photo.storageBucket === publicBucket) {
    const publicUrl = publicUrlFor(base, publicBucket, photo.storagePath);
    await prisma.marketplaceImage.upsert({
      where: {
        itemPhotoId_marketplace_environment: {
          itemPhotoId: photo.id,
          marketplace: "ebay",
          environment,
        },
      },
      create: {
        inventoryItemId: item.id,
        itemPhotoId: photo.id,
        marketplace: "ebay",
        environment,
        storagePath: photo.storagePath,
        publicUrl,
        status: "READY",
      },
      update: {
        storagePath: photo.storagePath,
        publicUrl,
        status: "READY",
      },
    });
    return { url: publicUrl };
  }

  const extension = supportedEbayImageTypes[photo.mimeType ?? ""];
  if (!extension) {
    return {
      error: `Unsupported eBay image type for photo ${photo.id}. Use JPEG, PNG, or WEBP.`,
    };
  }

  const derivativePath = [
    "ebay",
    environment,
    item.id,
    photo.id,
    `${randomId()}.${extension}`,
  ].join("/");
  let copyResponse: { data: unknown; error: { message: string } | null };
  try {
    copyResponse = await storage
      .from(photo.storageBucket)
      .copy(photo.storagePath, derivativePath, {
        destinationBucket: publicBucket,
      });
  } catch (error) {
    return {
      error: `Could not prepare eBay-visible photo ${photo.id}: ${
        error instanceof Error ? error.message : "Storage copy failed."
      }`,
    };
  }
  const { error } = copyResponse;
  if (error) {
    return {
      error: `Could not prepare eBay-visible photo ${photo.id}: ${error.message}`,
    };
  }

  const publicUrl = publicUrlFor(base, publicBucket, derivativePath);
  await prisma.marketplaceImage.upsert({
    where: {
      itemPhotoId_marketplace_environment: {
        itemPhotoId: photo.id,
        marketplace: "ebay",
        environment,
      },
    },
    create: {
      inventoryItemId: item.id,
      itemPhotoId: photo.id,
      marketplace: "ebay",
      environment,
      storagePath: derivativePath,
      publicUrl,
      status: "READY",
    },
    update: {
      storagePath: derivativePath,
      publicUrl,
      status: "READY",
    },
  });

  return { url: publicUrl };
}

function publicUrlFor(base: string, bucket: string, path: string) {
  const root = base.replace(/\/$/, "");
  return `${root}/storage/v1/object/public/${encodeURIComponent(
    bucket,
  )}/${encodeStoragePath(path)}`;
}

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}
