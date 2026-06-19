import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { executeBulkEbayPublish } from "@/lib/marketplace/bulk-publish";
import {
  BulkPublishExecuteRequestSchema,
  loadBulkPublishConfig,
} from "@/lib/marketplace/bulk-publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Live bulk publish. Gated to the live-eBay alpha allowlist AND an explicit
// confirmLivePublish:true. Every item is routed through executePublish (inside
// the service) so ownership, ready state, eBay readiness, the global production
// gate, and DB duplicate protection are each re-checked per item. One shared
// bulkRunId ties the whole run together for audit/inventory sync.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { itemIds, bulkRunId } = BulkPublishExecuteRequestSchema.parse(
      await request.json(),
    );

    requireFeatureAccess(user, "liveEbayPublish");

    const config = loadBulkPublishConfig();
    if (itemIds.length > config.maxItemsPerRequest) {
      throw new AppError(
        `Select at most ${config.maxItemsPerRequest} items per request.`,
        400,
        "BULK_PUBLISH_TOO_MANY_ITEMS",
      );
    }

    const result = await executeBulkEbayPublish(getPrisma(), {
      userId: user.id,
      itemIds,
      bulkRunId: bulkRunId ?? randomUUID(),
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "listings_publish_bulk",
      fallbackCode: "BULK_PUBLISH_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
