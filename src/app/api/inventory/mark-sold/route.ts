import { NextResponse } from "next/server";
import { z } from "zod";

import { safeErrorResponse } from "@/lib/errors";
import { markItemSold } from "@/lib/inventory/mark-sold";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Manual "I sold this" action. A thin, auth-gated wrapper over the engine's
// markItemSold, which loads the item scoped by the signed-in seller (404 if not
// owned), flips it to SOLD idempotently, queues delist for every OTHER live
// listing, and notifies the seller. Ownership is enforced inside the engine via
// the sellerId scope; this route never trusts the body for identity.

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

    const result = await markItemSold(getPrisma(), {
      inventoryItemId: body.inventoryItemId,
      userId: user.id,
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
