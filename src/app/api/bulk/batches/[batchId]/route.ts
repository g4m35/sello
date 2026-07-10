import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { getBulkBatchView } from "@/lib/bulk-intake/service";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId } = await params;
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    return NextResponse.json({
      batch: await getBulkBatchView(batchId, account.id, prisma),
    });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_batch_get");
  }
}
