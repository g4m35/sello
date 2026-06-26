import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import { AppError, safeClientMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Bulk-sets the seller price (cents) on the selected items and their drafts.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = await request.json();

    const ids: unknown = body?.ids;
    const priceCents: unknown = body?.priceCents;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
      throw new AppError("Provide 1 to 200 item ids.", 400);
    }
    const itemIds = ids.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (itemIds.length !== ids.length) throw new AppError("Invalid item ids.", 400);
    if (
      typeof priceCents !== "number" ||
      !Number.isInteger(priceCents) ||
      priceCents <= 0 ||
      priceCents > 100_000_00
    ) {
      throw new AppError("priceCents must be a positive integer.", 400);
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    // Scope to the active account's items only.
    const owned = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, ...accountScope(account) },
      select: { id: true },
    });
    const ownedIds = owned.map((o) => o.id);
    if (ownedIds.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    await prisma.$transaction([
      prisma.inventoryItem.updateMany({
        where: { id: { in: ownedIds } },
        data: { recommendedPriceCents: priceCents },
      }),
      prisma.listingDraft.updateMany({
        where: { inventoryItemId: { in: ownedIds } },
        data: { recommendedPriceCents: priceCents },
      }),
    ]);

    return NextResponse.json({ updated: ownedIds.length });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "listings_price" }) },
      { status },
    );
  }
}
