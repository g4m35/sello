import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { startBulkBatchGeneration } from "@/lib/bulk-intake/service";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Starts or resumes a durable batch. The response returns independently
// claimable item ids; the client invokes the per-item route sequentially so a
// serverless request never holds open across an entire large batch.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId } = await params;
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    return NextResponse.json(
      await startBulkBatchGeneration(batchId, account.id, prisma),
      { status: 202 },
    );
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_generation_start");
  }
}
