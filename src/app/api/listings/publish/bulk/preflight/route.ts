import { NextResponse } from "next/server";

import { featureAccessForUser } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { assertBulkBatchSize } from "@/lib/billing/batch";
import { accountWithEffectivePlan } from "@/lib/billing/effective-plan";
import { AppError, safeErrorResponse } from "@/lib/errors";
import {
  preflightBulkEbayPublish,
  preflightBulkStockXPublish,
} from "@/lib/marketplace/bulk-publish";
import {
  BulkPublishPreflightRequestSchema,
  loadBulkPublishConfig,
} from "@/lib/marketplace/bulk-publish-request";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Read-only dry run. Available to every authenticated seller. eBay keeps its
// alpha live-action copy; StockX uses strict exact-match/account checks and
// never makes provider mutation calls during preflight.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { itemIds, marketplace } = BulkPublishPreflightRequestSchema.parse(await request.json());

    const config = loadBulkPublishConfig();
    if (itemIds.length > config.maxItemsPerRequest) {
      throw new AppError(
        `Select at most ${config.maxItemsPerRequest} items per request.`,
        400,
        "BULK_PUBLISH_TOO_MANY_ITEMS",
      );
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    assertBulkBatchSize(accountWithEffectivePlan(account, user), itemIds.length, user);
    const result =
      marketplace === "stockx"
        ? await preflightBulkStockXPublish(prisma as never, {
            userId: user.id,
            accountId: account.id,
            itemIds,
          })
        : await preflightBulkEbayPublish(prisma, {
            userId: user.id,
            accountId: account.id,
            itemIds,
            livePublishAllowed: featureAccessForUser(user).liveEbayPublish,
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
