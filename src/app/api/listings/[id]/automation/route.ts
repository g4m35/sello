import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { LISTING_QUEUE, runListingJob } from "@/lib/automation/listing-job";
import { preparationRecoveryAction, PREPARATION_RETRY_MESSAGE, retryListingPreparation } from "@/lib/automation/recovery";
import { AppError, safeErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSupabaseUser(request);
    const db = getPrisma();
    const account = await getActiveAccount(user.id, db);
    const { id } = await params;
    const job = await db.jobLog.findFirst({
      where: { inventoryItemId: id, inventoryItem: { accountId: account.id }, queueName: LISTING_QUEUE },
      orderBy: { createdAt: "desc" }, select: { status: true, payload: true, result: true, updatedAt: true },
    });
    const result = job?.result && typeof job.result === "object" && !Array.isArray(job.result) ? job.result : {};
    return NextResponse.json({ job: job ? { status: job.status, message: typeof result.message === "string" ? result.message : "Preparing your listing…", updatedAt: job.updatedAt, recoveryAction: preparationRecoveryAction(job) } : null });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, { label: "listing_automation_status" });
    return NextResponse.json(body, { status });
  }
}

const RetrySchema = z.object({ action: z.literal("retry_preparation") }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSupabaseUser(request);
    const parsed = RetrySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("Choose retry preparation to continue. Nothing will be published.", 400);
    const db = getPrisma();
    const account = await getActiveAccount(user.id, db);
    const { id } = await params;
    const jobId = await retryListingPreparation({ inventoryItemId: id, accountId: account.id, userId: user.id }, db);
    after(() => runListingJob(jobId));
    return NextResponse.json({ job: { status: "QUEUED", message: PREPARATION_RETRY_MESSAGE, recoveryAction: null } }, { status: 202 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, { label: "listing_automation_retry" });
    return NextResponse.json(body, { status });
  }
}
