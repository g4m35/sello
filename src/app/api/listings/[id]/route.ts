import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { runCompFetch } from "@/lib/comps/fetch";
import { enabledCompSources } from "@/lib/comps/registry";
import { AppError, getErrorMessage } from "@/lib/errors";
import { ItemUpdateSchema } from "@/lib/listing-item-update";
import { getPrisma } from "@/lib/prisma";
import { createSupabaseServiceClient, requireSupabaseUser } from "@/lib/supabase/server";
import { mapAttempt, mapItemDetail } from "@/lib/view/server-map";

export const runtime = "nodejs";

// Full detail for a single inventory item (draft + per-channel listings +
// photos + recent publish attempts). Scoped to the seller; 404 otherwise.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;
    const prisma = getPrisma();

    const item = await prisma.inventoryItem.findFirst({
      where: { id, sellerId: user.id },
      include: {
        listingDrafts: { orderBy: { updatedAt: "desc" } },
        marketplaceListings: true,
        photos: { orderBy: { position: "asc" } },
      },
    });

    if (!item) {
      throw new AppError("Item not found", 404);
    }

    // First load with comp sources configured but no comps yet: gather them now.
    // Skipped entirely (no latency) when no source is enabled.
    if (enabledCompSources().length > 0) {
      const autoComps = await prisma.priceComp.count({
        where: { inventoryItemId: id, source: { startsWith: "auto:" } },
      });
      if (autoComps === 0) {
        await runCompFetch(prisma, id).catch(() => undefined);
      }
    }

    const attempts = await prisma.publishAttempt.findMany({
      where: { marketplaceListing: { inventoryItemId: id } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        marketplaceListing: {
          include: {
            inventoryItem: {
              include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
            },
          },
        },
      },
    });

    // Signed URLs so the UI can render the real uploaded photos (private bucket).
    const photoUrls = new Map<string, string | null>();
    if (item.photos.length > 0) {
      const storage = createSupabaseServiceClient().storage;
      await Promise.all(
        item.photos.map(async (photo) => {
          const { data } = await storage
            .from(photo.storageBucket)
            .createSignedUrl(photo.storagePath, 60 * 60);
          photoUrls.set(photo.id, data?.signedUrl ?? null);
        }),
      );
    }

    return NextResponse.json({
      item: mapItemDetail(item, attempts.map(mapAttempt), photoUrls),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

// Updates item-level identification fields (brand, category, condition, size,
// colorway, style code, product name). Draft text lives on a separate endpoint.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;
    const parsed = ItemUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid item update", 400);
    }

    const prisma = getPrisma();
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, sellerId: user.id },
      select: { id: true },
    });
    if (!existing) {
      throw new AppError("Item not found", 404);
    }

    const data: Prisma.InventoryItemUpdateInput = {};
    const u = parsed.data;
    if (u.productName !== undefined) data.productName = u.productName;
    if (u.brand !== undefined) data.brand = u.brand;
    if (u.category !== undefined) data.category = u.category;
    if (u.condition !== undefined) data.condition = u.condition;
    if (u.size !== undefined) data.size = u.size;
    if (u.colorway !== undefined) data.colorway = u.colorway;
    if (u.styleCode !== undefined) data.styleCode = u.styleCode;

    await prisma.inventoryItem.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
