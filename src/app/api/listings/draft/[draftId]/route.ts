import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { GeminiListingDraftSchema } from "@/lib/ai/listing-draft";
import { AppError, getErrorMessage } from "@/lib/errors";
import { ListingDraftUpdateSchema } from "@/lib/listing-draft-update";
import { evaluateReadiness } from "@/lib/lifecycle/readiness";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { loadItemDetailState } from "@/lib/view/load-item-detail";

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
        marketplaceDrafts: true,
        inventoryItem: {
          select: { productName: true },
        },
      },
    });

    if (!existingDraft) {
      throw new AppError("Listing draft not found.", 404);
    }

    if (update.approve) {
      const readiness = evaluateReadiness({
        productName: existingDraft.inventoryItem.productName,
        title: update.title,
        description: update.description,
        bulletPoints: update.bulletPoints,
        selectedMarketplaces: update.selectedMarketplaces,
        recommendedPriceCents: update.recommendedPriceCents,
      });

      if (!readiness.ready) {
        throw new AppError(
          `Item is not ready: ${readiness.issues.map((issue) => issue.message).join(" ")}`,
          400,
        );
      }
    }

    const [draft] = await prisma.$transaction([
      prisma.listingDraft.update({
        where: { id: existingDraft.id },
        data: {
          title: update.title,
          description: update.description,
          bulletPoints: update.bulletPoints,
          recommendedPriceCents: update.recommendedPriceCents,
          marketplaceDrafts: mergeMarketplaceDrafts(
            existingDraft.marketplaceDrafts,
            update.marketplaceDrafts,
          ) as Prisma.InputJsonValue,
          selectedMarketplaces: update.selectedMarketplaces,
          ...(update.measurements !== undefined
            ? { measurements: update.measurements as Prisma.InputJsonValue }
            : {}),
          ...(update.flaws !== undefined
            ? { flaws: update.flaws as Prisma.InputJsonValue }
            : {}),
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

    // Return the recomputed detail view so the editor can refresh readiness,
    // the status badge, and marketplace state live without a full reload. The
    // save already committed in the transaction above, so this read-back is
    // best-effort: if it fails the client just refreshes on its next load.
    let item = null;
    try {
      item = await loadItemDetailState(existingDraft.inventoryItemId, user.id);
    } catch {
      item = null;
    }

    return NextResponse.json({ draft, item });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

function mergeMarketplaceDrafts(
  existing: Prisma.JsonValue,
  update:
    | { ebay?: { categoryId: string; quantity?: number; aspects?: Record<string, string> } }
    | undefined,
) {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  if (!update?.ebay) {
    return current;
  }

  const ebay =
    current.ebay && typeof current.ebay === "object" && !Array.isArray(current.ebay)
      ? (current.ebay as Record<string, unknown>)
      : {};

  return {
    ...current,
    ebay: {
      ...ebay,
      categoryId: update.ebay.categoryId.trim(),
      quantity: update.ebay.quantity ?? 1,
      ...(update.ebay.aspects ? { aspects: update.ebay.aspects } : {}),
    },
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { draftId } = await context.params;
    const body = (await request.json()) as { action?: unknown };
    const action = body.action;
    const prisma = getPrisma();

    if (action !== "reset" && action !== "duplicate") {
      throw new AppError("Unsupported draft action.", 400);
    }

    const existingDraft = await prisma.listingDraft.findFirst({
      where: {
        id: draftId,
        inventoryItem: {
          sellerId: user.id,
        },
      },
      include: {
        inventoryItem: {
          include: {
            aiOutputs: {
              where: {
                kind: "listing_draft",
                errorMessage: null,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                validatedJson: true,
              },
            },
          },
        },
      },
    });

    if (!existingDraft) {
      throw new AppError("Listing draft not found.", 404);
    }

    if (action === "duplicate") {
      const draft = await prisma.listingDraft.create({
        data: {
          inventoryItemId: existingDraft.inventoryItemId,
          title: `${existingDraft.title} copy`.slice(0, 80),
          description: existingDraft.description,
          bulletPoints: existingDraft.bulletPoints,
          recommendedPriceCents: existingDraft.recommendedPriceCents,
          pricingRationale: existingDraft.pricingRationale,
          itemSpecifics: existingDraft.itemSpecifics as Prisma.InputJsonValue,
          marketplaceDrafts: existingDraft.marketplaceDrafts as Prisma.InputJsonValue,
          measurements: (existingDraft.measurements ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          flaws: (existingDraft.flaws ?? undefined) as Prisma.InputJsonValue | undefined,
          selectedMarketplaces: existingDraft.selectedMarketplaces,
          status: "DRAFT",
          approvedAt: null,
        },
      });

      return NextResponse.json({
        inventoryItem: {
          ...existingDraft.inventoryItem,
          aiOutputs: undefined,
        },
        draft,
        aiOutput: existingDraft.inventoryItem.aiOutputs[0]
          ? { id: existingDraft.inventoryItem.aiOutputs[0].id }
          : { id: "not-recorded" },
      });
    }

    const aiOutput = existingDraft.inventoryItem.aiOutputs[0];

    if (!aiOutput?.validatedJson) {
      throw new AppError("No validated AI draft is available to reset from.", 409);
    }

    const original = GeminiListingDraftSchema.parse(aiOutput.validatedJson);
    const [draft, inventoryItem] = await prisma.$transaction([
      prisma.listingDraft.update({
        where: { id: existingDraft.id },
        data: {
          status: "DRAFT",
          approvedAt: null,
          title: original.listingDraft.title,
          description: original.listingDraft.description,
          bulletPoints: original.listingDraft.bulletPoints,
          recommendedPriceCents: original.listingDraft.recommendedPriceCents,
          pricingRationale: original.listingDraft.pricingRationale,
          itemSpecifics: original.listingDraft.itemSpecifics as Prisma.InputJsonValue,
          marketplaceDrafts: original.marketplaceDrafts as Prisma.InputJsonValue,
          measurements: original.listingDraft.measurements.map((m) => ({
            ...m,
            source: m.source ?? "ai",
          })) as Prisma.InputJsonValue,
          flaws: original.listingDraft.flaws.map((f) => ({
            ...f,
            source: f.source ?? "ai",
          })) as Prisma.InputJsonValue,
          selectedMarketplaces: ["ebay", "grailed", "poshmark", "depop"],
        },
      }),
      prisma.inventoryItem.update({
        where: { id: existingDraft.inventoryItemId },
        data: {
          status: "DRAFT_READY",
          recommendedPriceCents: original.listingDraft.recommendedPriceCents,
          pricingRationale: original.listingDraft.pricingRationale,
        },
      }),
    ]);

    return NextResponse.json({
      inventoryItem,
      draft,
      aiOutput: { id: aiOutput.id },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
