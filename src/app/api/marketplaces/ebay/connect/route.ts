import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { assertCanConnectMarketplace } from "@/lib/billing/connections";
import { AppError, getErrorMessage } from "@/lib/errors";
import {
  getEbayConfig,
  getEbayOAuthStateSecret,
} from "@/lib/marketplace/adapters/ebay/config";
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
import {
  buildEbayAuthorizationUrl,
  createEbayOAuthStateCookie,
  createRandomEbayOAuthState,
} from "@/lib/marketplace/adapters/ebay/oauth";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);

    // Plan connection cap: block a new marketplace once at the plan limit
    // (reconnecting eBay is always allowed).
    const account = await getActiveAccount(user.id);
    await assertCanConnectMarketplace(account, "ebay");

    const config = getEbayConfig();
    const state = createRandomEbayOAuthState();
    const authorizationUrl = buildEbayAuthorizationUrl(config, state);
    const stateCookie = createEbayOAuthStateCookie({
      userId: user.id,
      state,
      secret: getEbayOAuthStateSecret(),
    });

    const response = wantsJson(request)
      ? NextResponse.json({ authorizationUrl: authorizationUrl.toString() })
      : NextResponse.redirect(authorizationUrl);

    response.cookies.set(stateCookie.name, stateCookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/marketplaces/ebay",
      maxAge: stateCookie.maxAge,
    });

    return response;
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json");
}
