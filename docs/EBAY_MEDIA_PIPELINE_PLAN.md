# eBay Media Pipeline

## Implemented Model

Original seller uploads stay in the private app photo bucket
`SUPABASE_STORAGE_BUCKET`. The editor and item detail route continue to render
those originals through short-lived signed URLs.

eBay readiness/publish prepares a marketplace-specific derivative before any
eBay inventory payload is built:

1. Load seller-owned item photos from the private bucket.
2. Reuse a `MarketplaceImage` row when the item photo, marketplace, and eBay
   environment already have a `READY` derivative.
3. Otherwise copy the private object into the configured public derivative
   bucket named by `EBAY_PUBLIC_IMAGE_BUCKET`.
4. Store an opaque public path and public URL on `MarketplaceImage`.
5. Build the eBay payload from `MarketplaceImage.publicUrl` only.

Public derivative paths intentionally do not include original filenames:

```text
ebay/{environment}/{inventoryItemId}/{itemPhotoId}/{random-token}.{jpg|png|webp}
```

Readiness and publish block with `ebay_public_photo` when durable public media
cannot be prepared. The blocked cases include missing bucket configuration, no
persisted photos, unsupported image types, and storage copy failures.

## Schema

This branch adds `MarketplaceImage` plus `MarketplaceImageStatus`.

The reuse key is unique on:

```text
itemPhotoId + marketplace + environment
```

The lookup index is:

```text
inventoryItemId + marketplace + environment + status
```

The first safe version tracks `storagePath`, `publicUrl`, and `status`. Future
image transform versions or source hashes can be added if the app starts
resizing, watermarking, or otherwise transforming bytes instead of copying the
seller photo object.

## Bucket Requirements

Create a dedicated Supabase Storage bucket before enabling production publish:

- Bucket name should match `EBAY_PUBLIC_IMAGE_BUCKET`.
- Bucket must allow public read access because eBay fetches image URLs outside
  the seller session.
- Browser/user clients must not get write access to this bucket.
- Server writes should run only through the service-role-backed API paths.
- Originals must remain in the private `SUPABASE_STORAGE_BUCKET` bucket.
- Allow JPEG, PNG, and WEBP objects. HEIC and unknown MIME types block before
  publish.
- Use a long cache TTL for ready derivatives if possible. Do not delete
  derivatives immediately on delist because ended listings, receipts, and
  support flows may still reference the URLs.

## Rollout Checklist

1. Merge and deploy this code only after gates pass.
2. Apply the `MarketplaceImage` migration with the normal production migration
   path. Do not use `prisma db push`.
3. Create the public derivative bucket in Supabase.
4. Confirm public reads work for a harmless uploaded object.
5. Confirm app clients cannot write to the public derivative bucket.
6. Set `EBAY_PUBLIC_IMAGE_BUCKET` in the target environment.
7. Keep `EBAY_PRODUCTION_PUBLISH_ENABLED` absent/off.
8. Run eBay readiness on an authenticated item with private original photos and
   confirm a `MarketplaceImage` row is created/reused.
9. Confirm the eBay preview image URLs point at the public derivative bucket and
   contain no private bucket path or original filename.
10. Only then consider a separate controlled live publish window.

## Cleanup Policy

Delist should not delete public images immediately. A later retention job can
mark unused derivatives stale and remove objects after a configured window.

Orphan cleanup should remain focused on eBay inventory/offer artifacts. Media
deletion should be a separate explicit operation so cleanup cannot break
evidence for recently ended listings.
