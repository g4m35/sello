import { after, NextResponse } from "next/server";
import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { enqueueBulkGeneration, runBulkGenerationJob } from "@/lib/bulk-intake/jobs";
import { bulkGroupingSchema } from "@/lib/bulk-intake/validation";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId } = await params;
    const { groups } = bulkGroupingSchema.partial().parse(await request.json());
    const prisma = getPrisma();
    const access = await resolveRuntimeEntitlements(user, prisma);
    const result = await enqueueBulkGeneration({ batchId, groups, user, account: { ...access.account, plan: access.plan } }, prisma);
    // One immediate item; the scheduler drains the remaining durable jobs.
    if (result.jobIds[0]) after(() => runBulkGenerationJob(result.jobIds[0]!, prisma));
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_generation_start");
  }
}
