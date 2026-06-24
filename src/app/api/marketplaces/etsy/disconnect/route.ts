import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { toEtsyErrorPayload } from "@/lib/marketplace/adapters/etsy/errors";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    // Removing the connection revokes Sello's stored token access for this seller.
    // Scoped to the signed-in user, so no one can disconnect another seller's shop.
    await getPrisma().marketplaceConnection.deleteMany({
      where: {
        userId: user.id,
        marketplace: "etsy",
        environment: ETSY_ENVIRONMENT,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

export const DELETE = POST;
