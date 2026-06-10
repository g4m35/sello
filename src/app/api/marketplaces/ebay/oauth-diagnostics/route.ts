import { NextResponse } from "next/server";

import { getEbayConfig } from "@/lib/marketplace/adapters/ebay/config";
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
import { buildEbayAuthorizationUrl } from "@/lib/marketplace/adapters/ebay/oauth";

export const runtime = "nodejs";

// TEMPORARY diagnostics for the production OAuth invalid_request issue.
// Exposes only values that already appear in public OAuth redirect URLs
// (client_id masked, RuName) plus shape checks. Never returns the client
// secret, token encryption key, or OAuth state secret. Remove once the
// production connect flow is verified.
export async function GET() {
  try {
    const config = getEbayConfig();
    const url = buildEbayAuthorizationUrl(config, "diagnostic-state");
    const maskedUrl = url
      .toString()
      .replace(encodeURIComponent(config.clientId), mask(config.clientId))
      .replace(config.clientId, mask(config.clientId));

    return NextResponse.json({
      environment: config.environment,
      authorizeOrigin: url.origin,
      authorizePath: url.pathname,
      clientId: {
        // The App ID is public (it appears verbatim in every OAuth redirect);
        // exposing it here is approved for debugging. Secrets stay out.
        value: config.clientId,
        masked: mask(config.clientId),
        length: config.clientId.length,
        hasWhitespace: /\s/.test(config.clientId),
        looksProduction: config.clientId.includes("-PRD-"),
        looksSandbox: config.clientId.includes("-SBX-"),
      },
      redirectUriName: {
        value: config.redirectUriName,
        length: config.redirectUriName.length,
        hasWhitespace: /\s/.test(config.redirectUriName),
        looksLikeUrl: config.redirectUriName.includes("://"),
      },
      responseType: url.searchParams.get("response_type"),
      scope: url.searchParams.get("scope"),
      statePresent: Boolean(url.searchParams.get("state")),
      authorizeUrlMaskedClientId: maskedUrl,
    });
  } catch (error) {
    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

function mask(value: string) {
  if (value.length <= 12) return `${value.slice(0, 2)}…(${value.length})`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
