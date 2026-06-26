import { NextResponse } from "next/server";

import { logUnexpectedError, safeErrorResponse } from "@/lib/errors";
import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { assertWithinQuota, incrementUsage } from "@/lib/billing/usage";
import { getPrisma } from "@/lib/prisma";
import { getEbayEnvironment } from "@/lib/marketplace/adapters/ebay/config";
import { EbayIntegrationError } from "@/lib/marketplace/adapters/ebay/errors";
import {
  executePublish,
  PublishingMigrationMissingError,
} from "@/lib/marketplace/publish-handler";
import { PublishRequestSchema } from "@/lib/marketplace/publish-request";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Non-eBay marketplaces remain draft-only and return a typed NOT_IMPLEMENTED
// outcome. eBay runs the guarded sandbox publish flow: blocked (typed
// EBAY_PUBLISH_NOT_ENABLED) unless EBAY_SANDBOX_PUBLISH_ENABLED=true. Every
// attempt is persisted for audit; the route never fakes a success.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { inventoryItemId, marketplace } = PublishRequestSchema.parse(
      await request.json(),
    );
    if (marketplace === "ebay" && getEbayEnvironment() === "production") {
      requireFeatureAccess(user, "liveEbayPublish");
    }

    // Monthly autopublish quota, enforced before the publish attempt.
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertWithinQuota(account, "autopublish", new Date());

    const result = await executePublish(prisma, {
      userId: user.id,
      accountId: account.id,
      inventoryItemId,
      marketplace,
    });

    // Count only a real, successful publish (2xx). Draft-only NOT_IMPLEMENTED
    // (501) and failures never burn quota. Best-effort, logged on failure.
    if (result.httpStatus >= 200 && result.httpStatus < 300) {
      try {
        await incrementUsage(account.id, "autopublish", new Date());
      } catch (usageError) {
        logUnexpectedError("autopublish_usage_increment", usageError);
      }
    }

    return NextResponse.json(
      {
        ...result.outcome,
        marketplaceListingId: result.marketplaceListingId,
        publishAttemptId: result.publishAttemptId,
      },
      { status: result.httpStatus },
    );
  } catch (error) {
    if (error instanceof PublishingMigrationMissingError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    if (error instanceof EbayIntegrationError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    const { status, body } = safeErrorResponse(error, {
      label: "listings_publish",
      fallbackCode: "PUBLISH_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
