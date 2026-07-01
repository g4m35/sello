import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import type { StockXConfig } from "./types";

type StockXEnv = Record<string, string | undefined>;

const DEFAULT_API_BASE_URL = "https://api.stockx.com/v2";
const DEFAULT_AUTH_BASE_URL = "https://accounts.stockx.com";
const DEFAULT_SCOPES = ["offline_access", "openid"];

const oauthRequiredEnv = [
  "STOCKX_CLIENT_ID",
  "STOCKX_CLIENT_SECRET",
  "STOCKX_REDIRECT_URI",
  "STOCKX_TOKEN_ENCRYPTION_KEY",
] as const;

export function isStockXApiEnabled(env: StockXEnv = process.env): boolean {
  return env.STOCKX_API_ENABLED === "true";
}

export function isStockXMarketDataEnabled(env: StockXEnv = process.env): boolean {
  return env.STOCKX_MARKET_DATA_ENABLED === "true";
}

export function isStockXListingEnabled(env: StockXEnv = process.env): boolean {
  return env.STOCKX_LISTING_ENABLED === "true";
}

export function getStockXOAuthConfig(env: StockXEnv = process.env): StockXConfig {
  if (!isStockXApiEnabled(env)) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notEnabled,
      "StockX API integration is not enabled.",
      503,
      { variable: "STOCKX_API_ENABLED" },
    );
  }

  for (const variable of oauthRequiredEnv) {
    assertEnvValue(env[variable], variable);
  }

  return {
    clientId: env.STOCKX_CLIENT_ID!,
    clientSecret: env.STOCKX_CLIENT_SECRET!,
    redirectUri: env.STOCKX_REDIRECT_URI!,
    apiBaseUrl: nonPlaceholder(env.STOCKX_API_BASE_URL) ?? DEFAULT_API_BASE_URL,
    authBaseUrl: nonPlaceholder(env.STOCKX_AUTH_BASE_URL) ?? DEFAULT_AUTH_BASE_URL,
    apiKey: nonPlaceholder(env.STOCKX_API_KEY) ?? null,
    scopes: parseScopes(env.STOCKX_SCOPES) ?? DEFAULT_SCOPES,
    tokenEncryptionKey: env.STOCKX_TOKEN_ENCRYPTION_KEY!,
  };
}

export function getStockXApiConfig(env: StockXEnv = process.env): StockXConfig {
  const config = getStockXOAuthConfig(env);
  if (!config.apiKey) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConfigured,
      "Missing required StockX environment variable: STOCKX_API_KEY",
      503,
      { variable: "STOCKX_API_KEY" },
    );
  }
  return config;
}

export function getStockXMarketDataConfig(env: StockXEnv = process.env): StockXConfig {
  if (!isStockXMarketDataEnabled(env)) {
    throw new StockXIntegrationError(
      stockxErrorCodes.marketDataNotEnabled,
      "StockX market data is not enabled.",
      503,
      { variable: "STOCKX_MARKET_DATA_ENABLED" },
    );
  }
  return getStockXApiConfig(env);
}

const minOAuthStateSecretBytes = 32;

export function getStockXOAuthStateSecret(env: StockXEnv = process.env): string {
  const secret = env.STOCKX_OAUTH_STATE_SECRET;

  if (
    !secret ||
    secret.includes("[") ||
    Buffer.byteLength(secret, "utf8") < minOAuthStateSecretBytes
  ) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConfigured,
      `Missing or weak StockX OAuth state secret. Set STOCKX_OAUTH_STATE_SECRET to at least ${minOAuthStateSecretBytes} bytes.`,
      503,
      { variable: "STOCKX_OAUTH_STATE_SECRET" },
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
    throw new StockXIntegrationError(
      stockxErrorCodes.notConfigured,
      `Missing required StockX environment variable: ${variable}`,
      503,
      { variable },
    );
  }
}
