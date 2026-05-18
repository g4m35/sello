import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { generateListingDraftWithGemini, GEMINI_PROMPT_VERSION } from "@/lib/ai/gemini";
import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { prepareListingPhotos, uploadListingPhotos } from "@/lib/storage/listing-photos";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { extractListingPhotos } from "@/lib/uploads";

export const runtime = "nodejs";

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

    return NextResponse.json({
      inventoryItem,
      draft,
      aiOutput: { id: aiOutput.id },
    });
  } catch (error) {
    const message = getErrorMessage(error);

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
