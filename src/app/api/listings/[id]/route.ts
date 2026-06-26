import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { ItemUpdateSchema } from "@/lib/listing-item-update";
import { getPrisma } from "@/lib/prisma";
import { createSupabaseServiceClient, requireSupabaseUser } from "@/lib/supabase/server";
import { loadItemDetailState } from "@/lib/view/load-item-detail";
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
    const account = await getActiveAccount(user.id, prisma);

    const item = await prisma.inventoryItem.findFirst({
      where: { id, ...accountScope(account) },
      include: {
        listingDrafts: { orderBy: { updatedAt: "desc" } },
        marketplaceListings: true,
        photos: { orderBy: { position: "asc" } },
      },
    });

    if (!item) {
      throw new AppError("Item not found", 404);
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
    const { status, body } = safeErrorResponse(error, {
      label: "listing_get",
      fallbackCode: "LISTING_LOAD_FAILED",
      fallbackMessage: "Couldn't load this listing right now. Please try again.",
    });
    return NextResponse.json(body, { status });
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
    const account = await getActiveAccount(user.id, prisma);
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, ...accountScope(account) },
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
    // Return the refreshed detail view so item edits (category, condition,
    // size, color) keep readiness and status panels in sync without a reload.
    // Best-effort: the update already committed, so a read-back failure must
    // not fail the request (the client refreshes on its next load).
    let item = null;
    try {
      item = await loadItemDetailState(id, account);
    } catch {
      item = null;
    }
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "listing_update",
      fallbackCode: "LISTING_UPDATE_FAILED",
      fallbackMessage: "Couldn't save this listing right now. Please try again.",
    });
    return NextResponse.json(body, { status });
  }
}
