import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
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

    const attempts = await prisma.publishAttempt.findMany({
      where: { marketplaceListing: { inventoryItem: { sellerId: user.id } } },
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
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
