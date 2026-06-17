# eBay Media Pipeline Plan

## Current Stabilization Guard

The post-live-run stabilization pass does not add a production migration. Until
the full derivative pipeline exists, eBay preflight and publish only accept item
photos that already live in the configured public marketplace bucket:

- `NEXT_PUBLIC_SUPABASE_URL` must be set.
- `EBAY_PUBLIC_IMAGE_BUCKET` must name the eBay-visible public bucket.
- Original private item-photo buckets are rejected with `ebay_public_photo`.

This keeps normal app uploads private and prevents accidental eBay payloads that
point at private or expiring signed URLs.

## Target Production Path

1. Keep user uploads in the existing private item-photo bucket.
2. When a seller runs eBay readiness or publish, build public marketplace
   derivatives for the selected photos.
3. Store derivatives in a dedicated public bucket with opaque paths:
   `ebay/{inventoryItemId}/{photoId}/{random-token}.jpg`.
4. Never use `originalName` or user-provided filenames in public paths.
5. Reuse an existing derivative when the source photo, transform version, and
   marketplace target match.
6. Record metadata so publish, delist, orphan cleanup, and future refreshes can
   reason about the image lifecycle.

## Suggested Schema

Add a `MarketplaceImage` table:

- `id`
- `inventoryItemId`
- `itemPhotoId`
- `marketplace`
- `environment`
- `storageBucket`
- `storagePath`
- `publicUrl`
- `sourceHash`
- `transformVersion`
- `status` (`READY`, `STALE`, `DELETED`, `FAILED`)
- `lastUsedAt`
- `createdAt`
- `updatedAt`

Indexes:

- unique reuse key on `itemPhotoId`, `marketplace`, `environment`,
  `sourceHash`, `transformVersion`
- lookup index on `inventoryItemId`, `marketplace`, `environment`, `status`

## Publish Flow

1. Load selected item photos from private storage.
2. For each photo, find a matching `READY` derivative.
3. If missing or stale, create a derivative in the public marketplace bucket.
4. Persist derivative metadata before eBay publish.
5. Build eBay inventory payload from `MarketplaceImage.publicUrl` only.
6. If no ready derivative exists, fail preflight before any eBay API call.

## Cleanup Policy

Delist should not delete public images immediately because ended eBay listings,
receipts, and customer-service flows may still reference them. A later explicit
retention job can mark unused derivatives stale and remove objects after a
configured retention window.

Orphan cleanup should only delete eBay inventory/offer artifacts. Marketplace
image deletion should be a separate explicit operation so media cleanup cannot
break evidence for a recently ended live listing.
