import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { assertBulkBatchSize } from "@/lib/billing/batch";
import { AppError, safeErrorResponse } from "@/lib/errors";
import {
  executeBulkEbayPublish,
  executeBulkStockXPublish,
} from "@/lib/marketplace/bulk-publish";
import {
  BulkPublishExecuteRequestSchema,
  loadBulkPublishConfig,
} from "@/lib/marketplace/bulk-publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Live bulk publish. eBay remains gated to the live-eBay alpha allowlist; every
// marketplace requires confirmLivePublish:true. StockX execution re-runs strict
// readiness before any live mutation and routes through the canonical single-
// item publish handler. One shared bulkRunId ties the run together for audit.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { itemIds, marketplace, bulkRunId } = BulkPublishExecuteRequestSchema.parse(
      await request.json(),
    );

    if (marketplace === "ebay") {
      requireFeatureAccess(user, "liveEbayPublish");
    }

    const config = loadBulkPublishConfig();
    if (itemIds.length > config.maxItemsPerRequest) {
      throw new AppError(
        `Select at most ${config.maxItemsPerRequest} items per request.`,
        400,
        "BULK_PUBLISH_TOO_MANY_ITEMS",
      );
    }

    // Plan bulk-batch cap (stricter than the global per-request ceiling).
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    assertBulkBatchSize(account, itemIds.length);

    const result =
      marketplace === "stockx"
        ? await executeBulkStockXPublish(prisma as never, {
            userId: user.id,
            accountId: account.id,
            itemIds,
            bulkRunId: bulkRunId ?? randomUUID(),
          })
        : await executeBulkEbayPublish(prisma, {
            userId: user.id,
            accountId: account.id,
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
