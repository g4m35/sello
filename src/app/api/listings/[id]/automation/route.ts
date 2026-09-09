import { NextResponse } from "next/server";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { LISTING_QUEUE } from "@/lib/automation/listing-job";
import { safeErrorResponse } from "@/lib/errors";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSupabaseUser(request);
    const db = getPrisma();
    const account = await getActiveAccount(user.id, db);
    const { id } = await params;
    const job = await db.jobLog.findFirst({
      where: { inventoryItemId: id, inventoryItem: { accountId: account.id }, queueName: LISTING_QUEUE },
      orderBy: { createdAt: "desc" }, select: { status: true, result: true, updatedAt: true },
    });
    const result = job?.result && typeof job.result === "object" && !Array.isArray(job.result) ? job.result : {};
    return NextResponse.json({ job: job ? { status: job.status, message: typeof result.message === "string" ? result.message : "Preparing your listing…", updatedAt: job.updatedAt } : null });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, { label: "listing_automation_status" });
    return NextResponse.json(body, { status });
  }
}
