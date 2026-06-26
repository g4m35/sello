import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { Marketplace, Prisma } from "@/generated/prisma/client";
import { safeErrorResponse } from "@/lib/errors";
import { parseMarketplaceEmail, isActionableSignalType } from "@/lib/inventory/email-parser";
import {
  handleSaleSignal,
  type HandleSaleSignalResult,
} from "@/lib/inventory/sale-signal";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Internal-only email-signal ingestion. A trusted email worker (not the public
// internet) POSTs parsed-but-raw marketplace emails here. This route:
//   1. fails closed on an internal shared secret (503 if unset, 401 on mismatch);
//   2. dedupes by providerMessageId (idempotent re-delivery);
//   3. parses the email, resolves the owning seller via a MarketplaceListing,
//      persists an EmailSignal row, and ONLY for actionable signal types with a
//      resolved user calls the safety engine. No user resolved => stored
//      unmatched, engine NEVER called. The engine itself never auto-delists
//      below high confidence, so low/medium just create review tasks.
// No live marketplace/network calls happen here; no secrets are logged.

const BodySchema = z
  .object({
    sourceEmail: z.string().min(1),
    destinationEmail: z.string().min(1),
    subject: z.string().default(""),
    textBody: z.string().default(""),
    htmlBody: z.string().nullish(),
    receivedAt: z.string().min(1),
    providerMessageId: z.string().min(1).nullish(),
  })
  .strict();

const BODY_SNIPPET_MAX = 280;

// --- Narrow Prisma surfaces (testable with a structural mock) ----------------

type EmailSignalRow = { id: string; userId: string | null };

type MatchListingRow = {
  id: string;
  inventoryItemId: string;
  inventoryItem: { sellerId: string } | null;
};

export type EmailIngestPrismaLike = {
  emailSignal: {
    findFirst(args: {
      where: { providerMessageId: string };
      select: { id: true; userId: true };
    }): Promise<EmailSignalRow | null>;
    create(args: {
      data: {
        userId: string | null;
        sourceEmail: string;
        destinationEmail: string;
        marketplaceGuess: Marketplace | null;
        signalType: import("@/generated/prisma/client").EmailSignalType;
        confidence: number;
        subject: string;
        bodySnippet: string;
        parsedPayload: Prisma.InputJsonValue;
        matchedInventoryItemId: string | null;
        matchedMarketplaceListingId: string | null;
        providerMessageId: string | null;
        processedAt: Date | null;
      };
    }): Promise<{ id: string }>;
  };
  marketplaceListing: {
    findFirst(args: {
      where: {
        marketplace: Marketplace;
        externalListingId?: string;
        externalUrl?: string;
      };
      select: {
        id: true;
        inventoryItemId: true;
        inventoryItem: { select: { sellerId: true } };
      };
    }): Promise<MatchListingRow | null>;
  };
};

// The engine surface; only invoked when a user is resolved + signal actionable.
type EngineLike = typeof handleSaleSignal;

type Resolution = {
  userId: string | null;
  marketplaceListingId: string | null;
  inventoryItemId: string | null;
};

// Timing-safe header compare. Length-guarded so unequal lengths never call
// timingSafeEqual with mismatched buffers.
function secretMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Prisma surfaces a unique-constraint violation as P2002. Here it can only mean
// a concurrent insert of the same providerMessageId (the one unique on the row).
function isProviderMessageIdConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function resolveOwner(
  db: EmailIngestPrismaLike,
  marketplace: Marketplace | undefined,
  hints: { externalListingId?: string; externalUrl?: string },
): Promise<Resolution> {
  const empty: Resolution = {
    userId: null,
    marketplaceListingId: null,
    inventoryItemId: null,
  };
  if (!marketplace) return empty;

  const select = {
    id: true,
    inventoryItemId: true,
    inventoryItem: { select: { sellerId: true } },
  } as const;

  if (hints.externalListingId) {
    const byId = await db.marketplaceListing.findFirst({
      where: { marketplace, externalListingId: hints.externalListingId },
      select,
    });
    if (byId?.inventoryItem) {
      return {
        userId: byId.inventoryItem.sellerId,
        marketplaceListingId: byId.id,
        inventoryItemId: byId.inventoryItemId,
      };
    }
  }

  if (hints.externalUrl) {
    const byUrl = await db.marketplaceListing.findFirst({
      where: { marketplace, externalUrl: hints.externalUrl },
      select,
    });
    if (byUrl?.inventoryItem) {
      return {
        userId: byUrl.inventoryItem.sellerId,
        marketplaceListingId: byUrl.id,
        inventoryItemId: byUrl.inventoryItemId,
      };
    }
  }

  return empty;
}

export async function POST(request: Request) {
  // Fail closed on the internal secret BEFORE any parsing or DB work.
  const expectedSecret = process.env.INVENTORY_EMAIL_INGEST_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: { code: "INGEST_DISABLED", message: "Email ingestion is not enabled." } },
      { status: 503 },
    );
  }
  const providedSecret = request.headers.get("x-internal-secret");
  if (!providedSecret || !secretMatches(providedSecret, expectedSecret)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid internal credentials." } },
      { status: 401 },
    );
  }

  return ingest(request, getPrisma() as unknown as EmailIngestPrismaLike, handleSaleSignal);
}

// Separated from POST so tests can drive it with a structural fake + a mock
// engine without stubbing the secret/header gate logic.
export async function ingest(
  request: Request,
  db: EmailIngestPrismaLike,
  engine: EngineLike,
) {
  try {
    const body = BodySchema.parse(await request.json());

    // Idempotency: a re-delivered provider message is acknowledged, not reparsed.
    if (body.providerMessageId) {
      const existing = await db.emailSignal.findFirst({
        where: { providerMessageId: body.providerMessageId },
        select: { id: true, userId: true },
      });
      if (existing) {
        return NextResponse.json({ ok: true, deduped: true, signalId: existing.id });
      }
    }

    const parsed = parseMarketplaceEmail({
      sourceEmail: body.sourceEmail,
      destinationEmail: body.destinationEmail,
      subject: body.subject,
      textBody: body.textBody,
      htmlBody: body.htmlBody ?? null,
    });

    const resolution = await resolveOwner(
      db,
      parsed.marketplaceGuess,
      parsed.matchHints,
    );

    const parsedPayload = {
      marketplaceGuess: parsed.marketplaceGuess ?? null,
      signalType: parsed.signalType,
      confidence: parsed.confidence,
      extracted: parsed.extracted,
      matchHints: parsed.matchHints,
      receivedAt: body.receivedAt,
    } satisfies Prisma.InputJsonValue;

    let signal: { id: string };
    try {
      signal = await db.emailSignal.create({
        data: {
          userId: resolution.userId,
          sourceEmail: body.sourceEmail,
          destinationEmail: body.destinationEmail,
          marketplaceGuess: parsed.marketplaceGuess ?? null,
          signalType: parsed.signalType,
          confidence: parsed.confidence,
          subject: body.subject,
          bodySnippet: body.textBody.slice(0, BODY_SNIPPET_MAX),
          parsedPayload,
          matchedInventoryItemId: resolution.inventoryItemId,
          matchedMarketplaceListingId: resolution.marketplaceListingId,
          providerMessageId: body.providerMessageId ?? null,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      // Concurrent re-delivery race: a second copy of the same provider message
      // lost the unique(providerMessageId) write. Acknowledge it as a dedupe
      // (idempotent), never reprocess or 500.
      if (isProviderMessageIdConflict(error)) {
        return NextResponse.json({ ok: true, deduped: true });
      }
      throw error;
    }

    // Never act without a resolved user, and only on actionable signal types.
    // Confidence still flows to the engine, which enforces the no-auto-delist
    // rule below high confidence — this route never delists on its own.
    const actionable =
      resolution.userId !== null &&
      parsed.marketplaceGuess !== undefined &&
      isActionableSignalType(parsed.signalType);

    let action: HandleSaleSignalResult["outcome"] | "none" = "none";
    if (actionable && resolution.userId && parsed.marketplaceGuess) {
      const result = await engine(db as never, {
        userId: resolution.userId,
        marketplace: parsed.marketplaceGuess,
        source: "email",
        externalListingId: parsed.matchHints.externalListingId ?? null,
        externalUrl: parsed.matchHints.externalUrl ?? null,
        title: parsed.extracted.title ?? null,
        price: parsed.extracted.priceCents ?? null,
        confidence: parsed.confidence,
        rawPayload: parsedPayload,
      });
      action = result.outcome;
    }

    return NextResponse.json({
      ok: true,
      signalId: signal.id,
      matched: resolution.userId !== null,
      action,
    });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_email_signals",
      fallbackCode: "EMAIL_INGEST_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
