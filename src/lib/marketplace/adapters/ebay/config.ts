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
