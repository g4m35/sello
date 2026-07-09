import { describe, expect, it, vi } from "vitest";

import {
  ebayPublicPhotoMissingCode,
  prepareEbayVisibleImages,
  type EbayMediaPrismaLike,
  type EbayStoredPhoto,
} from "./media";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  EBAY_PUBLIC_IMAGE_BUCKET: "ebay-public",
};

function createPrisma(opts?: {
  sellerId?: string;
  photos?: EbayStoredPhoto[];
  images?: Array<Record<string, unknown>>;
}) {
  const state = {
    images: [...(opts?.images ?? [])],
  };
  const sellerId = opts?.sellerId ?? "user-1";
  const photos: EbayStoredPhoto[] =
    opts?.photos ??
    [
      {
        id: "photo-1",
        inventoryItemId: "item-1",
        storageBucket: "listing-photos",
        storagePath: "user-1/item-1/0-private-front.jpg",
        mimeType: "image/jpeg",
        originalName: "front of shirt.jpg",
        position: 0,
      },
    ];

  const prisma = {
    _state: state,
    marketplaceImage: {
      findMany: vi.fn(async () => state.images),
      upsert: vi.fn(async ({ create, update }) => {
        const existing = state.images.find(
          (image) =>
            image.itemPhotoId === create.itemPhotoId &&
            image.marketplace === create.marketplace &&
            image.environment === create.environment,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `mi-${state.images.length + 1}`, ...create };
        state.images.push(row);
        return row;
      }),
    },
  };

  return {
    prisma: prisma as unknown as EbayMediaPrismaLike & { _state: typeof state },
    item: {
      id: "item-1",
      sellerId,
      photos,
    },
  };
}

function storage(copyImpl = vi.fn().mockResolvedValue({ data: { path: "ok" } })) {
  return {
    from: vi.fn(() => ({
      copy: copyImpl,
    })),
  };
}

describe("prepareEbayVisibleImages", () => {
  it("blocks when EBAY_PUBLIC_IMAGE_BUCKET is absent", async () => {
    const { prisma, item } = createPrisma();

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" },
      storage: storage(),
    });

    expect(result).toMatchObject({
      photos: [],
      missing: [ebayPublicPhotoMissingCode],
    });
    expect(prisma.marketplaceImage.upsert).not.toHaveBeenCalled();
  });

  it("reports missing eBay-visible image when an item has no photos", async () => {
    const { prisma, item } = createPrisma({ photos: [] });

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env,
      storage: storage(),
    });

    expect(result.photos).toEqual([]);
    expect(result.missing).toEqual([ebayPublicPhotoMissingCode]);
    expect(result.errors).toEqual([
      "Add at least one photo so Sello can prepare an eBay-visible listing image.",
    ]);
  });

  it("reuses existing ready derivatives without copying storage again", async () => {
    const { prisma, item } = createPrisma({
      images: [
        {
          itemPhotoId: "photo-1",
          marketplace: "ebay",
          environment: "production",
          status: "READY",
          publicUrl:
            "https://project.supabase.co/storage/v1/object/public/ebay-public/existing.jpg",
          storagePath: "existing.jpg",
        },
      ],
    });
    const storageClient = storage();

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env,
      storage: storageClient,
    });

    expect(result.photos).toEqual([
      {
        url: "https://project.supabase.co/storage/v1/object/public/ebay-public/existing.jpg",
      },
    ]);
    expect(storageClient.from).not.toHaveBeenCalled();
  });

  it("copies private originals into opaque public derivative paths", async () => {
    const copy = vi.fn().mockResolvedValue({ data: { path: "ignored" } });
    const { prisma, item } = createPrisma();

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env,
      storage: storage(copy),
      randomId: () => "opaque-token",
    });

    expect(result.missing).toEqual([]);
    expect(result.photos[0].url).toBe(
      "https://project.supabase.co/storage/v1/object/public/ebay-public/ebay/production/item-1/photo-1/opaque-token.jpg",
    );
    expect(result.photos[0].url).not.toContain("front%20of%20shirt");
    expect(result.photos[0].url).not.toContain("private-front");
    expect(copy).toHaveBeenCalledWith(
      "user-1/item-1/0-private-front.jpg",
      "ebay/production/item-1/photo-1/opaque-token.jpg",
      { destinationBucket: "ebay-public" },
    );
    expect(prisma.marketplaceImage.upsert).toHaveBeenCalled();
  });

  it("blocks unsupported image types before copying", async () => {
    const { prisma, item } = createPrisma({
      photos: [
        {
          id: "photo-1",
          inventoryItemId: "item-1",
          storageBucket: "listing-photos",
          storagePath: "user-1/item-1/0.heic",
          mimeType: "image/heic",
          originalName: "front.heic",
          position: 0,
        },
      ],
    });

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env,
      storage: storage(),
    });

    expect(result.missing).toEqual([ebayPublicPhotoMissingCode]);
    expect(result.errors[0]).toContain("Unsupported eBay image type");
    expect(prisma.marketplaceImage.upsert).not.toHaveBeenCalled();
  });

  it("allows media preparation after the caller loads an account-scoped item", async () => {
    const { prisma, item } = createPrisma({ sellerId: "someone-else" });

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env,
      storage: storage(),
    });

    expect(result.photos).toHaveLength(1);
    expect(result.missing).toEqual([]);
  });

  it("returns a typed preflight blocker when storage copy fails", async () => {
    const { prisma, item } = createPrisma();

    const result = await prepareEbayVisibleImages(prisma, {
      userId: "user-1",
      item,
      environment: "production",
      env,
      storage: storage(
        vi.fn().mockResolvedValue({
          data: null,
          error: { message: "bucket is not public" },
        }),
      ),
      randomId: () => "opaque-token",
    });

    expect(result.photos).toEqual([]);
    expect(result.missing).toEqual([ebayPublicPhotoMissingCode]);
    expect(result.errors).toEqual([
      "Could not prepare eBay-visible photo photo-1: bucket is not public",
    ]);
  });
});
