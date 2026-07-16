import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const notifications = await prisma.notification.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        inventoryItemId: true,
        readAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_notifications_list",
      fallbackCode: "NOTIFICATIONS_LIST_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
