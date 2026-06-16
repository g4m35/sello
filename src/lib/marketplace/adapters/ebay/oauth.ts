import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type { EbayConfig, EbayEnvironment, EbayTokenResponse } from "./types";

export const ebayOAuthStateCookieName = "ebay_oauth_state";

const authBaseUrls: Record<EbayEnvironment, string> = {
  sandbox: "https://auth.sandbox.ebay.com/oauth2/authorize",
  production: "https://auth.ebay.com/oauth2/authorize",
};
const tokenUrls: Record<EbayEnvironment, string> = {
  sandbox: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  production: "https://api.ebay.com/identity/v1/oauth2/token",
};
const requiredScopes = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

type StatePayload = {
  userId: string;
  state: string;
  expiresAt: number;
};

export function createRandomEbayOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function buildEbayAuthorizationUrl(config: EbayConfig, state: string) {
  const url = new URL(authBaseUrls[config.environment]);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUriName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", requiredScopes.join(" "));
  url.search = url.search.replace(/\+/g, "%20");
  return url;
}

export function createEbayOAuthStateCookie(args: {
  userId: string;
  state: string;
  secret: string;
  now?: Date;
}) {
  const expiresAt = (args.now ?? new Date()).getTime() + 10 * 60 * 1000;
  const payload: StatePayload = {
    userId: args.userId,
    state: args.state,
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = sign(encodedPayload, args.secret);

  return {
    name: ebayOAuthStateCookieName,
    value: `${encodedPayload}.${signature}`,
    maxAge: 10 * 60,
  };
}

export function parseEbayOAuthStateCookie(args: {
  cookieValue: string | null;
  expectedState: string | null;
  secret: string;
  now?: Date;
}) {
  if (!args.cookieValue || !args.expectedState) {
    throw invalidState();
  }

  const [encodedPayload, signature] = args.cookieValue.split(".");
  if (!encodedPayload || !signature) {
    throw invalidState();
  }

  if (!safeEqual(signature, sign(encodedPayload, args.secret))) {
    throw invalidState();
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as StatePayload;
  } catch {
    throw invalidState();
  }

  if (
    payload.state !== args.expectedState ||
    payload.expiresAt < (args.now ?? new Date()).getTime()
  ) {
    throw invalidState();
  }

  return payload;
}

export async function exchangeAuthorizationCode(
  config: EbayConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayTokenResponse> {
  const response = await fetchImpl(tokenUrls[config.environment], {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUriName,
    }),
  });

  if (!response.ok) {
    throw new EbayIntegrationError(
      ebayErrorCodes.tokenExchangeFailed,
      "eBay token exchange failed.",
      502,
      { status: response.status },
    );
  }

  return (await response.json()) as EbayTokenResponse;
}

// Application (client-credentials) access token. Used for app-scoped calls that
// are not tied to a connected seller, such as the Notification API getPublicKey
// endpoint required to validate inbound eBay notifications.
export async function fetchEbayApplicationToken(
  config: EbayConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(tokenUrls[config.environment], {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!response.ok) {
    throw new EbayIntegrationError(
      ebayErrorCodes.tokenExchangeFailed,
      "eBay application token request failed.",
      502,
      { status: response.status },
    );
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new EbayIntegrationError(
      ebayErrorCodes.tokenExchangeFailed,
      "eBay application token response did not include an access token.",
      502,
    );
  }
  return json.access_token;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function invalidState() {
  return new EbayIntegrationError(
    ebayErrorCodes.oauthStateInvalid,
    "The eBay authorization state is invalid or expired.",
    400,
  );
}
