import { NextResponse } from "next/server";

import type { InventoryStatus } from "@/generated/prisma/client";
import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import { AppError, safeClientMessage } from "@/lib/errors";
import { markItemSold } from "@/lib/inventory/mark-sold";
import {
  canTransition,
  toLifecycleState,
  type ItemLifecycleState,
} from "@/lib/lifecycle/item-status";
import {
  LifecycleRequestSchema,
  type LifecycleAction,
} from "@/lib/lifecycle/lifecycle-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ACTION_TARGET: Record<
  LifecycleAction,
  { state: ItemLifecycleState; status: InventoryStatus }
> = {
  mark_sold: { state: "sold", status: "SOLD" },
  delist: { state: "delisted", status: "DELISTED" },
};

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { inventoryItemId, action } = LifecycleRequestSchema.parse(
      await request.json(),
    );
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, ...accountScope(account) },
      select: { id: true, sellerId: true, status: true },
    });

    if (!item) {
      throw new AppError("Inventory item not found.", 404);
    }

    const current = toLifecycleState(item.status);
    const target = ACTION_TARGET[action];

    if (!canTransition(current, target.state)) {
      throw new AppError(
        `Cannot move a ${current} item to ${target.state}.`,
        409,
      );
    }

    // Marking sold must go through the safety engine so OTHER active listings are
    // delisted (closing the double-sell gap). The marketplace is unknown for a
    // manual lifecycle action, so soldSourceMarketplace is null and EVERY active
    // listing is queued for delist. The plain update is kept for 'delist'.
    if (action === "mark_sold") {
      await markItemSold(prisma, {
        inventoryItemId: item.id,
        userId: user.id,
        inventoryOwnerUserId: item.sellerId,
        soldMarketplace: null,
        source: "manual",
      });
      // Re-read for the existing { inventoryItem } response shape (API compat).
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { id: item.id },
      });
      return NextResponse.json({ inventoryItem });
    }

    const inventoryItem = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { status: target.status },
    });

    return NextResponse.json({ inventoryItem });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "listings_lifecycle" }) },
      { status },
    );
  }
}
