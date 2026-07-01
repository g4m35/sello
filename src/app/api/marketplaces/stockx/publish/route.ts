import { NextResponse } from "next/server";

import { safeErrorResponse } from "@/lib/errors";
import { isStockXListingCreationAvailable } from "@/lib/marketplace/adapters/stockx/capabilities";
import { stockxErrorCodes } from "@/lib/marketplace/adapters/stockx/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isStockXListingCreationAvailable()) {
    return NextResponse.json(
      {
        error: {
          code: stockxErrorCodes.listingNotEnabled,
          message: "StockX listing creation is disabled.",
        },
      },
      { status: 503 },
    );
  }

  try {
    await requireSupabaseUser(request);

    return NextResponse.json(
      {
        error: {
          code: stockxErrorCodes.listingReadinessRequired,
          message: "StockX listing creation requires future readiness gates.",
        },
      },
      { status: 501 },
    );
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "stockx_publish_placeholder",
      fallbackCode: "STOCKX_LISTING_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
