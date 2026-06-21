import { z } from "zod";
import { NextResponse } from "next/server";

import { AppError, safeClientMessage } from "@/lib/errors";
import { EbayIntegrationError } from "@/lib/marketplace/adapters/ebay/errors";
import {
  cleanupEbayOrphanArtifacts,
  scanEbayOrphanArtifacts,
  type EbayOrphanPrismaLike,
} from "@/lib/marketplace/adapters/ebay/orphans";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const OrphanActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("scan") }),
  z.object({ action: z.literal("cleanup"), confirmCleanup: z.literal(true) }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;
    const parsed = OrphanActionSchema.parse(await request.json());
    const prisma = getPrisma() as unknown as EbayOrphanPrismaLike;

    if (parsed.action === "cleanup") {
      const result = await cleanupEbayOrphanArtifacts(prisma, {
        userId: user.id,
        inventoryItemId: id,
        confirmCleanup: parsed.confirmCleanup,
      });
      return NextResponse.json(result);
    }

    const scan = await scanEbayOrphanArtifacts(prisma, {
      userId: user.id,
      inventoryItemId: id,
    });
    return NextResponse.json({ ok: true, scan });
  } catch (error) {
    if (error instanceof EbayIntegrationError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "ebay_orphans" }) },
      { status },
    );
  }
}
