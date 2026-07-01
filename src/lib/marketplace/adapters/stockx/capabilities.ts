import {
  isStockXApiEnabled,
  isStockXListingEnabled,
  isStockXMarketDataEnabled,
} from "./config";
import type { StockXStatusCapabilities } from "./types";

type Env = Record<string, string | undefined>;

export function resolveStockXCapabilities(
  env: Env = process.env,
): StockXStatusCapabilities {
  const apiEnabled = isStockXApiEnabled(env);
  const marketDataEnabled = isStockXMarketDataEnabled(env);
  return {
    connect: apiEnabled,
    catalogSearch: apiEnabled,
    productMatching: true,
    marketData: apiEnabled && marketDataEnabled,
    listingCreation: false,
    listingSync: false,
    orderSync: false,
  };
}

export function isStockXListingCreationAvailable(env: Env = process.env): boolean {
  return isStockXApiEnabled(env) && isStockXListingEnabled(env);
}
