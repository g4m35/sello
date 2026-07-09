import {
  isStockXApiConfigured,
  isStockXListingEnabled,
  isStockXMarketDataEnabled,
  isStockXOAuthConfigured,
} from "./config";
import type { StockXStatusCapabilities } from "./types";

type Env = Record<string, string | undefined>;

export function resolveStockXCapabilities(
  env: Env = process.env,
): StockXStatusCapabilities {
  const oauthConfigured = isStockXOAuthConfigured(env);
  const apiConfigured = isStockXApiConfigured(env);
  const marketDataEnabled = isStockXMarketDataEnabled(env);
  const listingCreation = apiConfigured && isStockXListingEnabled(env);
  return {
    connect: oauthConfigured,
    catalogSearch: apiConfigured,
    productMatching: true,
    marketData: apiConfigured && marketDataEnabled,
    listingCreation,
    listingSync: listingCreation,
    orderSync: false,
  };
}

export function isStockXListingCreationAvailable(env: Env = process.env): boolean {
  return isStockXApiConfigured(env) && isStockXListingEnabled(env);
}
