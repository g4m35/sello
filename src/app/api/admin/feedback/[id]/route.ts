import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/auth/admin";
import { AppError, getErrorMessage } from "@/lib/errors";
import { UpdateFeedbackSchema } from "@/lib/feedback/feedback-input";
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
    const parsed = UpdateFeedbackSchema.safeParse(await request.json());
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
    const status = error instanceof AppError ? error.status : isMissingRecord(error) ? 404 : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
