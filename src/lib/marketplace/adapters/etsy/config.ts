import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import type { EtsyConfig } from "./types";

type EtsyEnv = Record<string, string | undefined>;

const DEFAULT_API_BASE_URL = "https://api.etsy.com/v3/application";
const DEFAULT_SCOPES = [
  "shops_r",
  "listings_r",
  "listings_w",
  "listings_d",
  "transactions_r",
];

// Global kill switch for any outbound Etsy API behavior. Defaults to false and
// only the exact string "true" enables it, so a typo or stray value can never
// accidentally turn on live Etsy calls. Never exposed client-side.
export function isEtsyApiEnabled(env: EtsyEnv = process.env): boolean {
  return env.ETSY_API_ENABLED === "true";
}

// Required credentials for any authenticated Etsy call. Reading the config is the
// fail-closed gate: a missing or placeholder value throws notConfigured (503) so
// routes degrade to copy-ready rather than attempting a half-configured call.
const requiredEnv = [
  "ETSY_CLIENT_ID",
  "ETSY_REDIRECT_URI",
  "ETSY_TOKEN_ENCRYPTION_KEY",
] as const;

export function getEtsyConfig(env: EtsyEnv = process.env): EtsyConfig {
  if (!isEtsyApiEnabled(env)) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.notEnabled,
      "Etsy API integration is not enabled.",
      503,
      { variable: "ETSY_API_ENABLED" },
    );
  }

  for (const variable of requiredEnv) {
    assertEnvValue(env[variable], variable);
  }

  return {
    clientId: env.ETSY_CLIENT_ID!,
    // Etsy public apps use PKCE and do not send a client secret on token
    // exchange; it stays optional so a secret is only required if the app type
    // actually uses one.
    clientSecret: nonPlaceholder(env.ETSY_CLIENT_SECRET) ?? null,
    redirectUri: env.ETSY_REDIRECT_URI!,
    apiBaseUrl: nonPlaceholder(env.ETSY_API_BASE_URL) ?? DEFAULT_API_BASE_URL,
    scopes: parseScopes(env.ETSY_SCOPES) ?? DEFAULT_SCOPES,
    tokenEncryptionKey: env.ETSY_TOKEN_ENCRYPTION_KEY!,
  };
}

const minOAuthStateSecretBytes = 32;

// Dedicated secret for signing the OAuth state/PKCE cookie (HMAC), kept separate
// from ETSY_TOKEN_ENCRYPTION_KEY so the two cryptographic purposes never share a
// key. Validated lazily, only when the connect/callback routes run.
export function getEtsyOAuthStateSecret(env: EtsyEnv = process.env): string {
  const secret = env.ETSY_OAUTH_STATE_SECRET;

  if (
    !secret ||
    secret.includes("[") ||
    Buffer.byteLength(secret, "utf8") < minOAuthStateSecretBytes
  ) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.notConfigured,
      `Missing or weak Etsy OAuth state secret. Set ETSY_OAUTH_STATE_SECRET to at least ${minOAuthStateSecretBytes} bytes.`,
      503,
      { variable: "ETSY_OAUTH_STATE_SECRET" },
    );
  }

  return secret;
}

function parseScopes(value: string | undefined): string[] | null {
  const cleaned = nonPlaceholder(value);
  if (!cleaned) return null;
  const scopes = cleaned
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : null;
}

function nonPlaceholder(value: string | undefined): string | undefined {
  if (!value || value.includes("[")) return undefined;
  return value;
}

function assertEnvValue(value: string | undefined, variable: string) {
  if (!value || value.includes("[")) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.notConfigured,
      `Missing required Etsy environment variable: ${variable}`,
      503,
      { variable },
    );
  }
}
