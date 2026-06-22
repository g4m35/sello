import { NextResponse } from "next/server";

import { featureAccessForUser } from "@/lib/auth/feature-access";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { preflightBulkEbayDelist } from "@/lib/marketplace/bulk-delist";
import { BulkDelistPreflightRequestSchema } from "@/lib/marketplace/bulk-delist-request";
import { loadBulkPublishConfig } from "@/lib/marketplace/bulk-publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Read-only dry run for bulk end/delist. Available to every authenticated
// seller: it only classifies which selected items have a live eBay listing that
// can be ended vs which cannot. No outbound eBay write happens here.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { itemIds } = BulkDelistPreflightRequestSchema.parse(await request.json());

    const config = loadBulkPublishConfig();
    if (itemIds.length > config.maxItemsPerRequest) {
      throw new AppError(
        `Select at most ${config.maxItemsPerRequest} items per request.`,
        400,
        "BULK_DELIST_TOO_MANY_ITEMS",
      );
    }

    const liveDelistAllowed = featureAccessForUser(user).ebayDelist;
    const result = await preflightBulkEbayDelist(getPrisma() as never, {
      userId: user.id,
      itemIds,
      liveDelistAllowed,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "listings_delist_bulk_preflight",
      fallbackCode: "BULK_DELIST_PREFLIGHT_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
