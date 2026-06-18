import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { CreateFeedbackSchema } from "@/lib/feedback/feedback-input";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Submit feedback. The userId always comes from the verified session, never the
// request body (the schema is strict and rejects a client-supplied userId).
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const parsed = CreateFeedbackSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid feedback.", 400);
    }
    const data = parsed.data;
    const prisma = getPrisma();
    const created = await prisma.feedback.create({
      data: {
        userId: user.id,
        type: data.type,
        severity: data.severity,
        marketplace: data.marketplace ?? null,
        subject: data.subject,
        message: data.message,
        pageUrl: data.pageUrl ?? null,
        listingId: data.listingId ?? null,
        draftId: data.draftId ?? null,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

// Returns only the caller's own feedback (seller-scoped).
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const rows = await prisma.feedback.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        severity: true,
        marketplace: true,
        subject: true,
        status: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ rows });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
