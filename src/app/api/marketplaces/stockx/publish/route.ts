import { NextResponse } from "next/server";

import { isStockXListingCreationAvailable } from "@/lib/marketplace/adapters/stockx/capabilities";
import { stockxErrorCodes } from "@/lib/marketplace/adapters/stockx/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await requireSupabaseUser(request);

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

  return NextResponse.json(
    {
      error: {
        code: stockxErrorCodes.listingReadinessRequired,
        message: "StockX listing creation requires future readiness gates.",
      },
    },
    { status: 501 },
  );
}
