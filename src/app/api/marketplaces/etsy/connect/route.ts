import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import {
  assertCanConnectMarketplace,
  assertCanManageMarketplaceConnections,
} from "@/lib/billing/connections";
import { AppError, getErrorMessage } from "@/lib/errors";
import { getEtsyConfig, getEtsyOAuthStateSecret } from "@/lib/marketplace/adapters/etsy/config";
import { requireEtsyCapability } from "@/lib/marketplace/adapters/etsy/capabilities";
import { toEtsyErrorPayload } from "@/lib/marketplace/adapters/etsy/errors";
import {
  buildEtsyAuthorizationUrl,
  createEtsyOAuthStateCookie,
  createEtsyPkcePair,
  createRandomEtsyOAuthState,
} from "@/lib/marketplace/adapters/etsy/oauth";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    // Fail closed: only an allowlisted seller with the global switch on may begin
    // an Etsy OAuth flow.
    requireEtsyCapability(user, "connect");

    // Plan connection cap: block a new marketplace once at the plan limit
    // (reconnecting Etsy is always allowed).
    const account = await getActiveAccount(user.id);
    await assertCanManageMarketplaceConnections(account, user.id);
    await assertCanConnectMarketplace(account, "etsy", undefined, user);

    const config = getEtsyConfig();
    const state = createRandomEtsyOAuthState();
    const { codeVerifier, codeChallenge } = createEtsyPkcePair();
    const authorizationUrl = buildEtsyAuthorizationUrl(config, { state, codeChallenge });
    const stateCookie = createEtsyOAuthStateCookie({
      userId: user.id,
      state,
      codeVerifier,
      secret: getEtsyOAuthStateSecret(),
    });

    const response = wantsJson(request)
      ? NextResponse.json({ authorizationUrl: authorizationUrl.toString() })
      : NextResponse.redirect(authorizationUrl);

    response.cookies.set(stateCookie.name, stateCookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/marketplaces/etsy",
      maxAge: stateCookie.maxAge,
    });

    return response;
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json");
}
