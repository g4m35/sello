import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { safeClientMessage } from "@/lib/errors";
import { searchStockXCatalog } from "@/lib/marketplace/adapters/stockx/client";
import { getStockXApiConfig } from "@/lib/marketplace/adapters/stockx/config";
import { toStockXErrorPayload } from "@/lib/marketplace/adapters/stockx/errors";
import { loadStockXConnectionSession } from "@/lib/marketplace/adapters/stockx/session";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim();
    if (query.length < 2) {
      return NextResponse.json(
        { error: "Search with at least two characters." },
        { status: 400 },
      );
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const config = getStockXApiConfig();
    const session = await loadStockXConnectionSession(prisma, account.id, config);
    const candidates = await searchStockXCatalog(config, session.accessToken, {
      query,
      brand: url.searchParams.get("brand"),
      category: url.searchParams.get("category"),
      size: url.searchParams.get("size"),
    });

    return NextResponse.json({ candidates });
  } catch (error) {
    const { payload, status } = toStockXErrorPayload(error);
    if (payload.code !== "STOCKX_API_FAILED") {
      return NextResponse.json({ error: payload }, { status });
    }
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "stockx_catalog_search" }) },
      { status },
    );
  }
}
