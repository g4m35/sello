import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { mapItem } from "@/lib/view/server-map";

export const runtime = "nodejs";

// Lists all inventory items for the authenticated seller, mapped into the UI
// view model. Scoped strictly to the seller; no cross-user access.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();

    const items = await prisma.inventoryItem.findMany({
      where: { sellerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        listingDrafts: { orderBy: { updatedAt: "desc" } },
        marketplaceListings: true,
        _count: { select: { photos: true } },
      },
    });

    return NextResponse.json({ items: items.map(mapItem) });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
