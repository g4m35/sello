import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { isEtsyApiEnabled } from "@/lib/marketplace/adapters/etsy/config";
import {
  EtsyIntegrationError,
  etsyErrorCodes,
  toEtsyErrorPayload,
} from "@/lib/marketplace/adapters/etsy/errors";
import { syncEtsyListingForAccount } from "@/lib/marketplace/adapters/etsy/status-sync";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.object({ itemId: z.string().uuid() }).strict();

// Read-only status sync for a connected seller. Gated on the global switch and a
// real connection (via the authorized session); it changes no Etsy state.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    if (!isEtsyApiEnabled()) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.notEnabled,
        "Etsy API integration is not enabled.",
        503,
      );
    }

    const body = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    return NextResponse.json(await syncEtsyListingForAccount({ userId: user.id, accountId: account.id, itemId: body.itemId }, prisma));
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
