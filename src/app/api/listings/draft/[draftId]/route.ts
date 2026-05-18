import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { ListingDraftUpdateSchema } from "@/lib/listing-draft-update";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { draftId } = await context.params;
    const update = ListingDraftUpdateSchema.parse(await request.json());
    const prisma = getPrisma();

    const existingDraft = await prisma.listingDraft.findFirst({
      where: {
        id: draftId,
        inventoryItem: {
          sellerId: user.id,
        },
      },
      select: {
        id: true,
        inventoryItemId: true,
      },
    });

    if (!existingDraft) {
      throw new AppError("Listing draft not found.", 404);
    }

    const [draft] = await prisma.$transaction([
      prisma.listingDraft.update({
        where: { id: existingDraft.id },
        data: {
          title: update.title,
          description: update.description,
          bulletPoints: update.bulletPoints,
          recommendedPriceCents: update.recommendedPriceCents,
          selectedMarketplaces: update.selectedMarketplaces,
          status: update.approve ? "APPROVED" : "DRAFT",
          approvedAt: update.approve ? new Date() : null,
        },
      }),
      prisma.inventoryItem.update({
        where: { id: existingDraft.inventoryItemId },
        data: {
          status: update.approve ? "APPROVED" : "DRAFT_READY",
          recommendedPriceCents: update.recommendedPriceCents,
        },
      }),
    ]);

    return NextResponse.json({ draft });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
