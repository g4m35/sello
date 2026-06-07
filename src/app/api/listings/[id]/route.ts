import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
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

    return NextResponse.json({
      item: mapItemDetail(item, attempts.map(mapAttempt)),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
