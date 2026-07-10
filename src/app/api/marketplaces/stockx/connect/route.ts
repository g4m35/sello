import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import {
  assertCanConnectMarketplace,
  assertCanManageMarketplaceConnections,
} from "@/lib/billing/connections";
import { AppError, safeErrorResponse } from "@/lib/errors";
import {
  getStockXOAuthConfig,
  getStockXOAuthStateSecret,
} from "@/lib/marketplace/adapters/stockx/config";
import { toStockXErrorPayload } from "@/lib/marketplace/adapters/stockx/errors";
import {
  buildStockXAuthorizationUrl,
  createRandomStockXOAuthState,
  createStockXOAuthStateCookie,
} from "@/lib/marketplace/adapters/stockx/oauth";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const account = await getActiveAccount(user.id);
    await assertCanManageMarketplaceConnections(account, user.id);
    await assertCanConnectMarketplace(account, "stockx", undefined, user);

    const config = getStockXOAuthConfig();
    const state = createRandomStockXOAuthState();
    const authorizationUrl = buildStockXAuthorizationUrl(config, { state });
    const stateCookie = createStockXOAuthStateCookie({
      userId: user.id,
      state,
      secret: getStockXOAuthStateSecret(),
    });

    const response = wantsJson(request)
      ? NextResponse.json({ authorizationUrl: authorizationUrl.toString() })
      : NextResponse.redirect(authorizationUrl);

    response.cookies.set(stateCookie.name, stateCookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/marketplaces/stockx",
      maxAge: stateCookie.maxAge,
    });

    return response;
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("STOCKX_")) {
      const { status, body } = safeErrorResponse(error, { label: "stockx_connect" });
      return NextResponse.json(body, { status });
    }
    const { payload, status } = toStockXErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json");
}
