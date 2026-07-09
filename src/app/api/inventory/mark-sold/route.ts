import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { markItemSold } from "@/lib/inventory/mark-sold";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Manual "I sold this" action. The route authorizes item access through the
// active account, then passes the creator sellerId to the safety engine as its
// inventory-owner guard while preserving the signed-in user as actor/audit id.

const BodySchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    soldMarketplace: z.enum([
      "ebay",
      "grailed",
      "poshmark",
      "depop",
      "etsy",
      "tiktok_shop",
      "vinted",
      "stockx",
    ]),
    soldListingId: z.string().min(1).nullish(),
    soldPriceCents: z.number().int().nonnegative().nullish(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const body = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: body.inventoryItemId, ...accountScope(account) },
      select: { sellerId: true },
    });

    if (!item) {
      throw new AppError("Inventory item not found.", 404);
    }

    const result = await markItemSold(prisma, {
      inventoryItemId: body.inventoryItemId,
      userId: user.id,
      inventoryOwnerUserId: item.sellerId,
      soldMarketplace: body.soldMarketplace,
      soldListingId: body.soldListingId ?? null,
      soldPriceCents: body.soldPriceCents ?? null,
      source: "manual",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_mark_sold",
      fallbackCode: "MARK_SOLD_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
