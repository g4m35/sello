import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
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

    const result = await executePublish(getPrisma(), {
      userId: user.id,
      inventoryItemId,
      marketplace,
    });

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

    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
