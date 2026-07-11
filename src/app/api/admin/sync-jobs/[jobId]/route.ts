import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminUser } from "@/lib/auth/admin";
import { AppError, safeErrorResponse } from "@/lib/errors";
import {
  cancelSyncJob,
  retrySyncJobForAdmin,
  type SyncJobControlPrismaLike,
} from "@/lib/inventory-sync/jobs/worker";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

const BodySchema = z.object({ action: z.enum(["retry", "cancel"]) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const admin = await requireAdminUser(request);
    const { jobId } = await context.params;
    const { action } = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const db: SyncJobControlPrismaLike = {
      syncJob: {
        findFirst: (args) => prisma.syncJob.findFirst(args),
        updateMany: (args) => prisma.syncJob.updateMany(args),
      },
      inventoryEvent: {
        create: (args) => prisma.inventoryEvent.create(args),
      },
    };
    const changed = action === "retry"
      ? await retrySyncJobForAdmin(db, jobId, admin.id)
      : await cancelSyncJob(db, jobId, admin.id);
    if (!changed) {
      throw new AppError(
        action === "retry"
          ? "This job is not eligible for another retry."
          : "This job can no longer be canceled safely.",
        409,
        action === "retry" ? "SYNC_JOB_RETRY_NOT_ALLOWED" : "SYNC_JOB_CANCEL_NOT_ALLOWED",
      );
    }
    return NextResponse.json({ ok: true, jobId, status: action === "retry" ? "queued" : "canceled" });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "admin_sync_job_control",
      fallbackCode: "SYNC_JOB_CONTROL_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
