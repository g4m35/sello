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

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new AppError("Provide 1 to 200 item ids.", 400);
  }
  const ids = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length !== value.length) throw new AppError("Invalid item ids.", 400);
  return ids;
}

// Bulk-deletes the seller's items (cascades to drafts, photos, listings, etc.).
export async function DELETE(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = await request.json();
    const ids = parseIds(body?.ids);
    const prisma = getPrisma();

    const result = await prisma.inventoryItem.deleteMany({
      where: { id: { in: ids }, sellerId: user.id },
    });

    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
