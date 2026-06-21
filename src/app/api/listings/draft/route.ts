import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { generateListingDraftWithGemini, GEMINI_PROMPT_VERSION } from "@/lib/ai/gemini";
import { featureAccessForUser } from "@/lib/auth/feature-access";
import { runCompFetch } from "@/lib/comps/fetch";
import { AppError, safeClientMessage, safePersistedFailureReason } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { prepareListingPhotos, uploadListingPhotos } from "@/lib/storage/listing-photos";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { extractListingPhotos } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();

    const draft = await prisma.listingDraft.findFirst({
      where: {
        inventoryItem: {
          sellerId: user.id,
        },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        inventoryItem: {
          include: {
            aiOutputs: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });

    if (!draft) {
      return NextResponse.json({ draft: null });
    }

    const { inventoryItem, ...listingDraft } = draft;
    const [aiOutput] = inventoryItem.aiOutputs;

    return NextResponse.json({
      inventoryItem: {
        ...inventoryItem,
        aiOutputs: undefined,
      },
      draft: listingDraft,
      aiOutput: aiOutput ?? { id: "not-recorded" },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "draft_get" }) },
      { status },
    );
  }
}

export async function POST(request: Request) {
  let inventoryItemId: string | null = null;
  let prisma: ReturnType<typeof getPrisma> | null = null;

  try {
    const user = await requireSupabaseUser(request);
    const formData = await request.formData();
    const files = extractListingPhotos(formData);
    const photos = await prepareListingPhotos(files);

    prisma = getPrisma();
    inventoryItemId = randomUUID();
    const createdInventoryItemId = inventoryItemId;

    await prisma.inventoryItem.create({
      data: {
        id: createdInventoryItemId,
        sellerId: user.id,
        productName: "Awaiting Gemini identification",
      },
    });

    const uploadedPhotos = await uploadListingPhotos({
      sellerId: user.id,
      inventoryItemId: createdInventoryItemId,
      photos,
    });

    await prisma.itemPhoto.createMany({
      data: uploadedPhotos.map((photo) => ({
        inventoryItemId: createdInventoryItemId,
        storageBucket: photo.bucket,
        storagePath: photo.path,
        mimeType: photo.mimeType,
        originalName: photo.originalName,
        position: photo.position,
      })),
    });

    const gemini = await generateListingDraftWithGemini(photos);
    const { identification, listingDraft } = gemini.draft;

    const [inventoryItem, draft, aiOutput] = await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id: createdInventoryItemId },
        data: {
          status: "DRAFT_READY",
          productName: identification.productName,
          brand: identification.brand,
          category: identification.category,
          condition: identification.condition,
          styleCode: identification.styleCode,
          colorway: identification.colorway,
          size: identification.size,
          confidence: identification.confidence,
          recommendedPriceCents: listingDraft.recommendedPriceCents,
          pricingRationale: listingDraft.pricingRationale,
        },
      }),
      prisma.listingDraft.create({
        data: {
          inventoryItemId: createdInventoryItemId,
          title: listingDraft.title,
          description: listingDraft.description,
          bulletPoints: listingDraft.bulletPoints,
          recommendedPriceCents: listingDraft.recommendedPriceCents,
          pricingRationale: listingDraft.pricingRationale,
          itemSpecifics: listingDraft.itemSpecifics as Prisma.InputJsonValue,
          marketplaceDrafts: gemini.draft.marketplaceDrafts as Prisma.InputJsonValue,
          measurements: listingDraft.measurements.map((m) => ({
            ...m,
            source: m.source ?? "ai",
          })) as Prisma.InputJsonValue,
          flaws: listingDraft.flaws.map((f) => ({
            ...f,
            source: f.source ?? "ai",
          })) as Prisma.InputJsonValue,
          selectedMarketplaces: ["ebay", "grailed", "poshmark", "depop"],
        },
      }),
      prisma.aiOutput.create({
        data: {
          inventoryItemId: createdInventoryItemId,
          provider: "gemini",
          model: gemini.model,
          kind: "listing_draft",
          promptVersion: GEMINI_PROMPT_VERSION,
          rawText: gemini.rawText,
          rawJson: gemini.rawJson as Prisma.InputJsonValue,
          validatedJson: gemini.draft as Prisma.InputJsonValue,
        },
      }),
    ]);

    // Best-effort: gather automatic comps now that the item is identified.
    // No-op (and fast) when no comp source is configured; never blocks the draft.
    await runCompFetch(prisma, createdInventoryItemId, user.id, {
      paidProvidersAllowed: featureAccessForUser(user).paidComps,
    }).catch(() => undefined);

    return NextResponse.json({
      inventoryItem,
      draft,
      aiOutput: { id: aiOutput.id },
    });
  } catch (error) {
    // Sanitized for BOTH the persisted aiOutput.errorMessage and the client
    // response, so a raw Gemini/Prisma/provider error never leaks or is stored.
    const message = safePersistedFailureReason(error, "Listing identification failed.");

    if (inventoryItemId && prisma) {
      await prisma.inventoryItem
        .update({
          where: { id: inventoryItemId },
          data: { status: "AI_FAILED" },
        })
        .catch(() => undefined);

      await prisma.aiOutput
        .create({
          data: {
            inventoryItemId,
            provider: "gemini",
            model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
            kind: "listing_draft",
            promptVersion: GEMINI_PROMPT_VERSION,
            errorMessage: message,
          },
        })
        .catch(() => undefined);
    }

    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
