import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { executePublish } from "@/lib/marketplace/publish-handler";
import { PublishRequestSchema } from "@/lib/marketplace/publish-request";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Publishing is intentionally NOT implemented. This route persists the
// attempt (MarketplaceListing + PublishAttempt + MarketplaceEvent) for audit
// and returns the adapter's typed NOT_IMPLEMENTED outcome. It never contacts
// a marketplace and never reports success.
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
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
