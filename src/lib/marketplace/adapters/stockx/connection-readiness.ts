import {
  fetchStockXMarketData,
  searchStockXCatalog,
} from "@/lib/marketplace/adapters/stockx/client";
import {
  getStockXApiConfig,
  getStockXMarketDataConfig,
  isStockXApiConfigured,
  isStockXMarketDataEnabled,
  isStockXOAuthConfigured,
} from "@/lib/marketplace/adapters/stockx/config";
import { StockXIntegrationError, stockxErrorCodes } from "@/lib/marketplace/adapters/stockx/errors";
import { loadStockXConnectionSession } from "@/lib/marketplace/adapters/stockx/session";
import { getPrisma } from "@/lib/prisma";

type Db = ReturnType<typeof getPrisma>;

export type StockXSetupState =
  | "not_connected"
  | "reconnect_required"
  | "seller_profile_incomplete"
  | "ready"
  | "unknown";

export type StockXConnectionReadiness = {
  connected: boolean;
  setupState: StockXSetupState;
  ready: boolean;
  reconnectRequired: boolean;
  sellerProfileIncomplete: boolean;
  nextStep: {
    code: StockXSetupState;
    message: string;
    externalUrl: string | null;
  } | null;
};

const STOCKX_SELLER_SETUP_URL = "https://stockx.com/selling";

type ProbeDeps = {
  prisma: Db;
  accountId: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
};

/**
 * Live StockX connection readiness for Settings → Marketplaces.
 * OAuth row alone is not enough — market-data fails until billing/shipping
 * are finished on stockx.com.
 */
export async function probeStockXConnectionReadiness(
  deps: ProbeDeps,
): Promise<StockXConnectionReadiness> {
  const env = deps.env ?? process.env;

  if (!isStockXOAuthConfigured(env)) {
    return connectionReadiness("not_connected");
  }

  let accessToken: string;
  try {
    const config = getStockXApiConfig(env);
    const session = await loadStockXConnectionSession(
      deps.prisma,
      deps.accountId,
      config,
      { fetchImpl: deps.fetchImpl },
    );
    accessToken = session.accessToken;
  } catch (error) {
    if (error instanceof StockXIntegrationError) {
      if (error.code === stockxErrorCodes.notConnected) {
        return connectionReadiness("not_connected");
      }
      if (
        error.code === stockxErrorCodes.reconnectRequired ||
        error.code === stockxErrorCodes.tokenRefreshFailed
      ) {
        return connectionReadiness("reconnect_required");
      }
    }
    return connectionReadiness("unknown");
  }

  // Without market-data, OAuth validity is the readiness bar.
  if (!isStockXMarketDataEnabled(env) || !isStockXApiConfigured(env)) {
    return connectionReadiness("ready");
  }

  try {
    const config = getStockXMarketDataConfig(env);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const candidates = await searchStockXCatalog(
      config,
      accessToken,
      { query: "nike dunk" },
      fetchImpl,
    );
    const productId = candidates[0]?.productId;
    if (!productId) {
      // Catalog works but empty — treat OAuth as healthy.
      return connectionReadiness("ready");
    }
    await fetchStockXMarketData(
      config,
      accessToken,
      { productId, currencyCode: "USD" },
      fetchImpl,
    );
    return connectionReadiness("ready");
  } catch (error) {
    if (
      error instanceof StockXIntegrationError &&
      error.code === stockxErrorCodes.sellerProfileIncomplete
    ) {
      return connectionReadiness("seller_profile_incomplete");
    }
    if (
      error instanceof StockXIntegrationError &&
      (error.code === stockxErrorCodes.reconnectRequired ||
        error.code === stockxErrorCodes.tokenRefreshFailed)
    ) {
      return connectionReadiness("reconnect_required");
    }
    // Transient API failures should not block the settings page.
    return connectionReadiness("unknown");
  }
}

export function connectionReadiness(
  setupState: StockXSetupState,
): StockXConnectionReadiness {
  const connected = setupState !== "not_connected";
  const reconnectRequired = setupState === "reconnect_required";
  const sellerProfileIncomplete = setupState === "seller_profile_incomplete";
  const ready = setupState === "ready";

  return {
    connected,
    setupState,
    ready,
    reconnectRequired,
    sellerProfileIncomplete,
    nextStep: nextStepFor(setupState),
  };
}

function nextStepFor(
  setupState: StockXSetupState,
): StockXConnectionReadiness["nextStep"] {
  switch (setupState) {
    case "not_connected":
      return {
        code: setupState,
        message: "Connect StockX to match products and pull market data.",
        externalUrl: null,
      };
    case "reconnect_required":
      return {
        code: setupState,
        message: "Your StockX connection expired. Reconnect to continue.",
        externalUrl: null,
      };
    case "seller_profile_incomplete":
      return {
        code: setupState,
        message: "Finish billing and shipping on StockX, then recheck.",
        externalUrl: STOCKX_SELLER_SETUP_URL,
      };
    case "ready":
      return null;
    case "unknown":
      return {
        code: setupState,
        message: "Could not verify StockX setup. Recheck in a moment.",
        externalUrl: null,
      };
    default: {
      const _exhaustive: never = setupState;
      return _exhaustive;
    }
  }
}

export function stockxConnectionStatusLabel(
  readiness: Pick<StockXConnectionReadiness, "setupState">,
): string {
  switch (readiness.setupState) {
    case "not_connected":
      return "Not connected";
    case "reconnect_required":
      return "Connection expired";
    case "seller_profile_incomplete":
      return "Connected · finish setup";
    case "ready":
      return "Connected · ready";
    case "unknown":
      return "Connected · check setup";
    default: {
      const _exhaustive: never = readiness.setupState;
      return _exhaustive;
    }
  }
}
