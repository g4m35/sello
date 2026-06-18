import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
} from "@/lib/feedback/feedback-input";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

function pick(value: string | null, allowed: readonly string[]): string | undefined {
  return value && allowed.includes(value) ? value : undefined;
}

// Owner/admin only: read + triage all feedback. requireAdminUser is the server-
// side boundary (404 to non-admins); never relies on a client guard.
export async function GET(request: Request) {
  try {
    await requireAdminUser(request);
    const prisma = getPrisma();
    const url = new URL(request.url);
    const where: {
      status?: string;
      type?: string;
      severity?: string;
      marketplace?: string;
    } = {};
    const status = pick(url.searchParams.get("status"), FEEDBACK_STATUSES);
    const type = pick(url.searchParams.get("type"), FEEDBACK_TYPES);
    const severity = pick(url.searchParams.get("severity"), FEEDBACK_SEVERITIES);
    const marketplace = url.searchParams.get("marketplace");
    if (status) where.status = status;
    if (type) where.type = type;
    if (severity) where.severity = severity;
    if (marketplace) where.marketplace = marketplace;

    const [rows, openCount] = await Promise.all([
      prisma.feedback.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.feedback.count({ where: { status: "open" } }),
    ]);

    return NextResponse.json({ rows, openCount });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("admin_feedback_fetch_failed");
    return NextResponse.json({ error: "admin_feedback_fetch_failed" }, { status: 500 });
  }
}
