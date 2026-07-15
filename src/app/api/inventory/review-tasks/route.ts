import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

const QuerySchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]).default("open"),
});

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const query = QuerySchema.parse({
      status: new URL(request.url).searchParams.get("status") ?? undefined,
    });

    const reviewTasks = await prisma.reviewTask.findMany({
      where: { accountId: account.id, status: query.status },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        status: true,
        inventoryItemId: true,
        marketplace: true,
        title: true,
        description: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    return NextResponse.json({ reviewTasks });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_review_tasks_list",
      fallbackCode: "REVIEW_TASKS_LIST_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
