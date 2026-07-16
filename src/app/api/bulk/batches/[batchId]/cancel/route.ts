import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { cancelBulkBatch } from "@/lib/bulk-intake/service";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId } = await params;
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    return NextResponse.json({
      batch: await cancelBulkBatch(batchId, account.id, prisma),
    });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_batch_cancel");
  }
}
