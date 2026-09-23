import { after, NextResponse } from "next/server";
import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { enqueueBulkGeneration, runBulkGenerationJob } from "@/lib/bulk-intake/jobs";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string; itemId: string }> }) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId, itemId } = await params;
    const prisma = getPrisma();
    const resolved = await resolveRuntimeEntitlements(user, prisma);
    const result = await enqueueBulkGeneration({ batchId, itemId, user, account: { ...resolved.account, plan: resolved.plan } }, prisma);
    if (result.jobIds[0]) after(() => runBulkGenerationJob(result.jobIds[0]!, prisma));
    const item = result.batch.items.find(entry => entry.id === itemId)!;
    return NextResponse.json({ item: { ...item, itemId: item.id }, batch: result.batch }, { status: 202 });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_item_generate");
  }
}
