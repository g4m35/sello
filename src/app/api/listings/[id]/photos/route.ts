import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { prepareListingPhotos, uploadListingPhotos } from "@/lib/storage/listing-photos";
import { requireSupabaseUser } from "@/lib/supabase/server";
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

    const item = await prisma.inventoryItem.findFirst({
      where: { id, sellerId: user.id },
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
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
