import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type { EbayConfig, EbayMarketplaceId } from "./types";

type EbayEnv = Record<string, string | undefined>;

const requiredEnv = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_REDIRECT_URI_NAME",
  "EBAY_TOKEN_ENCRYPTION_KEY",
] as const;

export function getEbayConfig(env: EbayEnv = process.env): EbayConfig {
  const environment = env.EBAY_ENV ?? "sandbox";

  if (environment !== "sandbox") {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConfigured,
      "Only eBay sandbox mode is enabled. Production eBay APIs are disabled.",
      503,
      { variable: "EBAY_ENV" },
    );
  }

  for (const variable of requiredEnv) {
    assertEnvValue(env[variable], variable);
  }

  const marketplaceId = env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
  if (marketplaceId !== "EBAY_US") {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConfigured,
      "Only EBAY_US is supported for eBay sandbox readiness checks.",
      503,
      { variable: "EBAY_MARKETPLACE_ID" },
    );
  }

  return {
    environment,
    clientId: env.EBAY_CLIENT_ID!,
    clientSecret: env.EBAY_CLIENT_SECRET!,
    redirectUriName: env.EBAY_REDIRECT_URI_NAME!,
    marketplaceId: marketplaceId as EbayMarketplaceId,
    tokenEncryptionKey: env.EBAY_TOKEN_ENCRYPTION_KEY!,
  };
}

// Server-side gate for real eBay sandbox publish calls. Defaults to false and
// only the exact string "true" enables publishing, so a typo or stray value can
// never accidentally turn on outbound listing creation. Never exposed client-side.
export function isEbaySandboxPublishEnabled(env: EbayEnv = process.env): boolean {
  return env.EBAY_SANDBOX_PUBLISH_ENABLED === "true";
}

const minOAuthStateSecretBytes = 32;

// Dedicated secret for signing the OAuth state cookie (HMAC), kept separate from
// EBAY_TOKEN_ENCRYPTION_KEY so the two cryptographic purposes never share a key
// and can be rotated independently. Validated lazily, only when the OAuth
// connect/callback routes run, so unrelated app paths and builds do not need it.
export function getEbayOAuthStateSecret(env: EbayEnv = process.env): string {
  const secret = env.EBAY_OAUTH_STATE_SECRET;

  if (
    !secret ||
    secret.includes("[") ||
    Buffer.byteLength(secret, "utf8") < minOAuthStateSecretBytes
  ) {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConfigured,
      `Missing or weak eBay OAuth state secret. Set EBAY_OAUTH_STATE_SECRET to at least ${minOAuthStateSecretBytes} bytes.`,
      503,
      { variable: "EBAY_OAUTH_STATE_SECRET" },
    );
  }

  return secret;
}

function assertEnvValue(value: string | undefined, variable: string) {
  if (!value || value.startsWith("[") || value.includes("[")) {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConfigured,
      `Missing required eBay sandbox environment variable: ${variable}`,
      503,
      { variable },
    );
  }
}
