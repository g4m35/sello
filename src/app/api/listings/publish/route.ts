import { NextResponse } from "next/server";
import { safeErrorResponse } from "@/lib/errors";
import { EbayIntegrationError } from "@/lib/marketplace/adapters/ebay/errors";
import { StockXIntegrationError } from "@/lib/marketplace/adapters/stockx/errors";
import { PublishingMigrationMissingError } from "@/lib/marketplace/publish-handler";
import { PublishRequestSchema } from "@/lib/marketplace/publish-request";
import { publishForUser } from "@/lib/marketplace/publish-service";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const input = PublishRequestSchema.parse(await request.json());
    const result = await publishForUser(user, input, request.headers.get("idempotency-key") ?? undefined);
    return NextResponse.json({
      ...result.outcome,
      marketplaceListingId: result.marketplaceListingId,
      publishAttemptId: result.publishAttemptId,
    }, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof PublishingMigrationMissingError || error instanceof EbayIntegrationError || error instanceof StockXIntegrationError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }
    const { status, body } = safeErrorResponse(error, { label: "listings_publish", fallbackCode: "PUBLISH_FAILED" });
    return NextResponse.json(body, { status });
  }
}
