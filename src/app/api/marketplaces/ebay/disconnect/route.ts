import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    await getPrisma().marketplaceConnection.deleteMany({
      where: {
        userId: user.id,
        marketplace: "ebay",
        environment: "sandbox",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

export const DELETE = POST;
