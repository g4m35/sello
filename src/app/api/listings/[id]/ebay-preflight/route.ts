import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
import {
  preflightEbayListing,
  type EbayPreflightPrismaLike,
} from "@/lib/marketplace/adapters/ebay/preflight";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Dry-run only: validates the listing and previews the exact eBay payloads.
// Performs no outbound eBay calls and can never create or modify a listing.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;

    const result = await preflightEbayListing(
      getPrisma() as unknown as EbayPreflightPrismaLike,
      { userId: user.id, inventoryItemId: id },
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
