import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { assertBulkBatchSize } from "@/lib/billing/batch";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { executeBulkEbayDelist } from "@/lib/marketplace/bulk-delist";
import { BulkDelistExecuteRequestSchema } from "@/lib/marketplace/bulk-delist-request";
import { loadBulkPublishConfig } from "@/lib/marketplace/bulk-publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Live bulk end/delist. Gated to the eBay-delist alpha allowlist AND an explicit
// confirmLiveDelist:true. Every item is routed through executeEbayDelist so the
// live confirmation, ownership, the already-ended / in-flight guards,
// idempotency, and sanitized failure recording are re-checked per item. One
// shared bulkRunId ties the whole run together for audit. No local delete.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { itemIds, bulkRunId } = BulkDelistExecuteRequestSchema.parse(
      await request.json(),
    );

    requireFeatureAccess(user, "ebayDelist");

    const config = loadBulkPublishConfig();
    if (itemIds.length > config.maxItemsPerRequest) {
      throw new AppError(
        `Select at most ${config.maxItemsPerRequest} items per request.`,
        400,
        "BULK_DELIST_TOO_MANY_ITEMS",
      );
    }

    // Plan bulk-batch cap (stricter than the global per-request ceiling).
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    assertBulkBatchSize(account, itemIds.length);

    const result = await executeBulkEbayDelist(prisma as never, {
      userId: user.id,
      accountId: account.id,
      itemIds,
      bulkRunId: bulkRunId ?? randomUUID(),
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "listings_delist_bulk",
      fallbackCode: "BULK_DELIST_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
