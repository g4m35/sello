import { NextResponse } from "next/server";

import { runCompFetch } from "@/lib/comps/fetch";
import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Fetches fresh automatic comps for an item from all enabled comp sources.
// Returns 0 honestly when no source is configured (no invented prices).
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = await request.json();
    const inventoryItemId: unknown = body?.inventoryItemId;
    if (typeof inventoryItemId !== "string" || !inventoryItemId) {
      throw new AppError("inventoryItemId is required", 400);
    }

    const prisma = getPrisma();
    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, sellerId: user.id },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    const result = await runCompFetch(prisma, inventoryItemId, user.id);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
