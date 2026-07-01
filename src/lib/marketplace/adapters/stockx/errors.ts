import { AppError } from "@/lib/errors";

export const stockxErrorCodes = {
  notConfigured: "STOCKX_NOT_CONFIGURED",
  notEnabled: "STOCKX_NOT_ENABLED",
  notConnected: "STOCKX_NOT_CONNECTED",
  reconnectRequired: "STOCKX_RECONNECT_REQUIRED",
  oauthStateInvalid: "STOCKX_OAUTH_STATE_INVALID",
  tokenExchangeFailed: "STOCKX_TOKEN_EXCHANGE_FAILED",
  tokenRefreshFailed: "STOCKX_TOKEN_REFRESH_FAILED",
  apiFailed: "STOCKX_API_FAILED",
  catalogSearchFailed: "STOCKX_CATALOG_SEARCH_FAILED",
  marketDataFailed: "STOCKX_MARKET_DATA_FAILED",
  marketDataNotEnabled: "STOCKX_MARKET_DATA_NOT_ENABLED",
  listingNotEnabled: "STOCKX_LISTING_NOT_ENABLED",
  listingReadinessRequired: "STOCKX_LISTING_READINESS_REQUIRED",
  matchSaveFailed: "STOCKX_MATCH_SAVE_FAILED",
} as const;

export type StockXErrorCode = (typeof stockxErrorCodes)[keyof typeof stockxErrorCodes];

export class StockXIntegrationError extends AppError {
  constructor(
    public readonly code: StockXErrorCode,
    message: string,
    status = 503,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, status, code);
    this.name = "StockXIntegrationError";
  }

  toPayload() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function toStockXErrorPayload(error: unknown) {
  if (error instanceof StockXIntegrationError) {
    return { payload: error.toPayload(), status: error.status };
  }

  if (error instanceof AppError) {
    return {
      payload: {
        code: error.code ?? stockxErrorCodes.apiFailed,
        message: error.message,
      },
      status: error.status,
    };
  }

  return {
    payload: {
      code: stockxErrorCodes.apiFailed,
      message: "StockX request failed.",
    },
    status: 500,
  };
}
