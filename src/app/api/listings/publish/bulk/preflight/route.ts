import { NextResponse } from "next/server";

import { featureAccessForUser } from "@/lib/auth/feature-access";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { preflightBulkEbayPublish } from "@/lib/marketplace/bulk-publish";
import {
  BulkPublishPreflightRequestSchema,
  loadBulkPublishConfig,
} from "@/lib/marketplace/bulk-publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Read-only dry run. Available to every authenticated seller — non-allowlisted
// users still see exactly which of their selected items are ready, blocked, or
// already listed; they just get livePublishAllowed:false plus alpha copy and no
// outbound eBay write happens here.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { itemIds } = BulkPublishPreflightRequestSchema.parse(await request.json());

    const config = loadBulkPublishConfig();
    if (itemIds.length > config.maxItemsPerRequest) {
      throw new AppError(
        `Select at most ${config.maxItemsPerRequest} items per request.`,
        400,
        "BULK_PUBLISH_TOO_MANY_ITEMS",
      );
    }

    const livePublishAllowed = featureAccessForUser(user).liveEbayPublish;
    const result = await preflightBulkEbayPublish(getPrisma(), {
      userId: user.id,
      itemIds,
      livePublishAllowed,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "listings_publish_bulk_preflight",
      fallbackCode: "BULK_PUBLISH_PREFLIGHT_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
