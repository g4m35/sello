import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { canPublish, toLifecycleState } from "@/lib/lifecycle/item-status";
import { getMarketplaceAdapter } from "@/lib/marketplace/adapter";
import { PublishRequestSchema } from "@/lib/marketplace/publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Publishing is intentionally NOT implemented. This route exists so the
// readiness gate and adapter contract are real and testable. It never
// contacts a marketplace and never reports success.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { inventoryItemId, marketplace } = PublishRequestSchema.parse(
      await request.json(),
    );
    const prisma = getPrisma();

    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, sellerId: user.id },
      select: { id: true, status: true },
    });

    if (!item) {
      throw new AppError("Inventory item not found.", 404);
    }

    if (!canPublish(toLifecycleState(item.status))) {
      throw new AppError(
        "Publishing is blocked until the item reaches the ready state.",
        409,
      );
    }

    const outcome = await getMarketplaceAdapter(marketplace).publishDraft({
      inventoryItemId: item.id,
    });

    // Honest 501: the item could be published, but the feature does not exist.
    return NextResponse.json(outcome, { status: 501 });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
