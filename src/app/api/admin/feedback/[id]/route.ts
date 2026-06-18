import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { FeedbackIdSchema, UpdateFeedbackSchema } from "@/lib/feedback/feedback-input";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function isMissingRecord(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as { code?: string }).code === "P2025",
  );
}

// Owner/admin only: triage a feedback row (status and/or admin notes).
export async function PATCH(request: Request, context: Context) {
  try {
    await requireAdminUser(request);
    const { id } = await context.params;
    if (!FeedbackIdSchema.safeParse(id).success) {
      throw new AppError("invalid_feedback_id", 400);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("invalid_json", 400);
    }
    const parsed = UpdateFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid update.", 400);
    }

    const data: { status?: string; adminNotes?: string | null } = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.adminNotes !== undefined) data.adminNotes = parsed.data.adminNotes ?? null;

    const updated = await getPrisma().feedback.update({
      where: { id },
      data: data as never,
      select: { id: true, status: true, adminNotes: true, updatedAt: true },
    });
    return NextResponse.json({ ok: true, feedback: updated });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isMissingRecord(error)) {
      return NextResponse.json({ error: "feedback_not_found" }, { status: 404 });
    }
    console.error("admin_feedback_update_failed");
    return NextResponse.json({ error: "admin_feedback_update_failed" }, { status: 500 });
  }
}
