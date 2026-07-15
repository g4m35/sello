import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Seller resolves (confirms-as-handled) or dismisses one of their review tasks.
// Ownership is enforced in the same write: updateMany is scoped to the active
// account, so every active member sees the same task queue while foreign
// accounts remain indistinguishable from missing rows.
// resolvedAt is stamped so the task leaves the open queue. No engine side effects
// here — this only closes the task.

const BodySchema = z
  .object({
    status: z.enum(["resolved", "dismissed"]),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const updated = await prisma.reviewTask.updateMany({
      where: { id, accountId: account.id, status: "open" },
      data: { status: body.status, resolvedAt: new Date() },
    });

    if (updated.count === 0) {
      // Either not owned, not found, or already closed — never reveal which.
      throw new AppError("Review task not found.", 404);
    }

    return NextResponse.json({ ok: true, id, status: body.status });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_review_task_resolve",
      fallbackCode: "REVIEW_TASK_RESOLVE_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
