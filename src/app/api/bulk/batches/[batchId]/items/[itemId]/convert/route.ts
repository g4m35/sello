import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { generateBulkItem } from "@/lib/bulk-intake/service";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Idempotent conversion: an already-converted item returns its existing normal
// inventory id; an unconverted ready/retryable item runs the same generation
// path used by the per-item endpoint.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string; itemId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId, itemId } = await params;
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    return NextResponse.json({
      item: await generateBulkItem({ batchId, itemId, account, user }, prisma),
    });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_item_convert");
  }
}
