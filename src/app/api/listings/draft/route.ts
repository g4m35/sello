import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { generateListingDraftWithGemini, GEMINI_PROMPT_VERSION } from "@/lib/ai/gemini";
import { getActiveAccount } from "@/lib/billing/account";
import {
  releaseUsageReservation,
  reserveUsageOrThrow,
  settleUsageReservation,
} from "@/lib/billing/usage";
import { isAdminUser } from "@/lib/auth/admin";
import { featureAccessForUser } from "@/lib/auth/feature-access";
import { applyDefaultEbayDraftFields } from "@/lib/listing/default-ebay-draft";
import { asStringRecord } from "@/lib/listing/ebay-draft-fields";
import { runCompFetch } from "@/lib/comps/fetch";
import {
  AppError,
  logUnexpectedError,
  safeClientMessage,
  safePersistedFailureReason,
} from "@/lib/errors";
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
  let usageReservationId: string | null = null;
  let usageIdempotencyKey: string | null = null;

  try {
    const user = await requireSupabaseUser(request);

    prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    usageIdempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();
    const reservation = await reserveUsageOrThrow({
      accountId: account.id,
      metric: "ai_listing",
      idempotencyKey: usageIdempotencyKey,
      now: new Date(),
      user,
    }, prisma);
    if (reservation.idempotent) {
      throw new AppError(
        "This listing-generation request is already in progress or completed.",
        409,
        "USAGE_REQUEST_ALREADY_RESERVED",
      );
    }
    usageReservationId = reservation.reservationId;

    const formData = await request.formData();
    const files = extractListingPhotos(formData);
    const photos = await prepareListingPhotos(files);

    inventoryItemId = randomUUID();
    const createdInventoryItemId = inventoryItemId;

    await prisma.inventoryItem.create({
      data: {
        id: createdInventoryItemId,
        sellerId: user.id,
        accountId: account.id,
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

    // Default the new draft toward publish-ready: resale quantity 1 and a
    // high-confidence inferred eBay category, without overwriting AI values.
    const marketplaceDrafts = applyDefaultEbayDraftFields({
      title: listingDraft.title,
      brand: identification.brand,
      description: listingDraft.description,
      productCategory: identification.category,
      size: identification.size,
      itemSpecifics: asStringRecord(listingDraft.itemSpecifics),
      marketplaceDrafts: gemini.draft.marketplaceDrafts,
    });

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
          marketplaceDrafts: marketplaceDrafts as Prisma.InputJsonValue,
          measurements: listingDraft.measurements.map((m) => ({
            ...m,
            source: m.source ?? "ai",
          })) as Prisma.InputJsonValue,
          flaws: listingDraft.flaws.map((f) => ({
            ...f,
            source: f.source ?? "ai",
          })) as Prisma.InputJsonValue,
          selectedMarketplaces: ["ebay", "grailed", "poshmark", "depop", "etsy"],
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

    try {
      await settleUsageReservation(usageReservationId, new Date(), prisma);
    } catch (usageError) {
      logUnexpectedError("ai_listing_usage_settlement", usageError);
    }

    // Best-effort: gather automatic comps now that the item is identified.
    // No-op (and fast) when no comp source is configured; never blocks the draft.
    await runCompFetch(prisma, createdInventoryItemId, user.id, {
      paidProvidersAllowed: featureAccessForUser(user).paidComps,
      adminOverride: isAdminUser(user),
      accountId: account.id,
      idempotencyKey: `${usageIdempotencyKey}:auto-comps`,
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

    if (usageReservationId && prisma) {
      await releaseUsageReservation(usageReservationId, new Date(), prisma).catch(
        (usageError) => logUnexpectedError("ai_listing_usage_release", usageError),
      );
    }

    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
