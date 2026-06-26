import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { inventoryChildScope } from "@/lib/billing/scope";
import { AppError, safeClientMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { mapAttempt } from "@/lib/view/server-map";

export const runtime = "nodejs";

// Publish-attempt audit log for the seller, newest first. Reflects the real
// (currently NOT_IMPLEMENTED) publish attempts; nothing is faked.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const attempts = await prisma.publishAttempt.findMany({
      where: { marketplaceListing: inventoryChildScope(account) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        marketplaceListing: {
          include: {
            inventoryItem: {
              include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
            },
          },
        },
      },
    });

    return NextResponse.json({ attempts: attempts.map(mapAttempt) });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "history_list" }) },
      { status },
    );
  }
}
