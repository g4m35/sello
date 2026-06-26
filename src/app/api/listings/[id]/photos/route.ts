import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import { AppError, safeClientMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { coverOrder } from "@/lib/photo-order";
import { prepareListingPhotos, uploadListingPhotos } from "@/lib/storage/listing-photos";
import { createSupabaseServiceClient, requireSupabaseUser } from "@/lib/supabase/server";
import { extractListingPhotos } from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_TOTAL_PHOTOS = 12;

// Appends photos to an existing item. Positions continue after the current ones
// so ordering (and the cover = position 0) is preserved.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const item = await prisma.inventoryItem.findFirst({
      where: { id, ...accountScope(account) },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    const formData = await request.formData();
    const files = extractListingPhotos(formData);

    const existingCount = await prisma.itemPhoto.count({
      where: { inventoryItemId: id },
    });
    if (existingCount + files.length > MAX_TOTAL_PHOTOS) {
      throw new AppError(`An item can have at most ${MAX_TOTAL_PHOTOS} photos.`, 400);
    }

    const prepared = (await prepareListingPhotos(files)).map((photo, index) => ({
      ...photo,
      position: existingCount + index,
    }));

    const uploaded = await uploadListingPhotos({
      sellerId: user.id,
      inventoryItemId: id,
      photos: prepared,
    });

    await prisma.itemPhoto.createMany({
      data: uploaded.map((photo) => ({
        inventoryItemId: id,
        storageBucket: photo.bucket,
        storagePath: photo.path,
        mimeType: photo.mimeType,
        originalName: photo.originalName,
        position: photo.position,
      })),
    });

    return NextResponse.json({ added: uploaded.length });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "listing_photos" }) },
      { status },
    );
  }
}

// Sets a photo as the cover (position 0), re-sequencing the rest. Body: { photoId }.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;
    const body = await request.json();
    const photoId: unknown = body?.photoId;
    if (typeof photoId !== "string" || !photoId) {
      throw new AppError("photoId is required", 400);
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const item = await prisma.inventoryItem.findFirst({
      where: { id, ...accountScope(account) },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    const photos = await prisma.itemPhoto.findMany({
      where: { inventoryItemId: id },
      orderBy: { position: "asc" },
    });
    const order = coverOrder(photos.map((p) => p.id), photoId);
    if (order[0] !== photoId) {
      throw new AppError("Photo not found", 404);
    }

    await prisma.$transaction(
      order.map((pid, index) =>
        prisma.itemPhoto.update({ where: { id: pid }, data: { position: index } }),
      ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "listing_photos" }) },
      { status },
    );
  }
}

// Removes a single photo (Storage object + row) and re-sequences positions so
// the first photo stays the cover. Pass ?photoId=...
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;
    const photoId = new URL(request.url).searchParams.get("photoId");
    if (!photoId) {
      throw new AppError("photoId is required", 400);
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const photo = await prisma.itemPhoto.findFirst({
      where: { id: photoId, inventoryItem: { id, ...accountScope(account) } },
    });
    if (!photo) {
      throw new AppError("Photo not found", 404);
    }

    await createSupabaseServiceClient()
      .storage.from(photo.storageBucket)
      .remove([photo.storagePath])
      .catch(() => undefined);

    await prisma.itemPhoto.delete({ where: { id: photo.id } });

    const remaining = await prisma.itemPhoto.findMany({
      where: { inventoryItemId: id },
      orderBy: { position: "asc" },
    });
    await Promise.all(
      remaining
        .map((p, index) => ({ p, index }))
        .filter(({ p, index }) => p.position !== index)
        .map(({ p, index }) =>
          prisma.itemPhoto.update({ where: { id: p.id }, data: { position: index } }),
        ),
    );

    return NextResponse.json({ deleted: 1, remaining: remaining.length });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "listing_photos" }) },
      { status },
    );
  }
}
