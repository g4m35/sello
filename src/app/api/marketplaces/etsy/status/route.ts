import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { resolveEtsyCapabilities } from "@/lib/marketplace/adapters/etsy/capabilities";
import { isEtsyApiEnabled } from "@/lib/marketplace/adapters/etsy/config";
import { toEtsyErrorPayload } from "@/lib/marketplace/adapters/etsy/errors";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Drives the settings Etsy card. Read-only; reflects whether the API is enabled,
// the seller's per-capability allowlist state, and whether a connection exists.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const capabilities = resolveEtsyCapabilities(user);

    let connected = false;
    if (isEtsyApiEnabled()) {
      const prisma = getPrisma();
      const account = await getActiveAccount(user.id, prisma);
      const connection = await prisma.marketplaceConnection.findUnique({
        where: {
          accountId_marketplace_environment: {
            accountId: account.id,
            marketplace: "etsy",
            environment: ETSY_ENVIRONMENT,
          },
        },
        select: { id: true },
      });
      connected = Boolean(connection);
    }

    return NextResponse.json({
      apiEnabled: isEtsyApiEnabled(),
      connected,
      capabilities,
    });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
