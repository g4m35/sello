import { NextResponse } from "next/server";

import type { InventoryStatus } from "@/generated/prisma/client";
import { AppError, getErrorMessage } from "@/lib/errors";
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

    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, sellerId: user.id },
      select: { id: true, status: true },
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

    const inventoryItem = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        status: target.status,
        soldAt: target.state === "sold" ? new Date() : undefined,
      },
    });

    return NextResponse.json({ inventoryItem });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
