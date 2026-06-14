import { AppError } from "@/lib/errors";

export const ebayErrorCodes = {
  notConfigured: "EBAY_NOT_CONFIGURED",
  notConnected: "EBAY_NOT_CONNECTED",
  reconnectRequired: "EBAY_RECONNECT_REQUIRED",
  oauthStateInvalid: "EBAY_OAUTH_STATE_INVALID",
  tokenExchangeFailed: "EBAY_TOKEN_EXCHANGE_FAILED",
  tokenRefreshFailed: "EBAY_TOKEN_REFRESH_FAILED",
  policyMissing: "EBAY_POLICY_MISSING",
  locationMissing: "EBAY_LOCATION_MISSING",
  locationCreateFailed: "EBAY_LOCATION_CREATE_FAILED",
  readinessFailed: "EBAY_READINESS_FAILED",
  apiFailed: "EBAY_API_FAILED",
  publishNotEnabled: "EBAY_PUBLISH_NOT_ENABLED",
  alreadyPublished: "EBAY_ALREADY_PUBLISHED",
  publishFailed: "EBAY_PUBLISH_FAILED",
  delistFailed: "EBAY_DELIST_FAILED",
  orphanCleanupFailed: "EBAY_ORPHAN_CLEANUP_FAILED",
} as const;

export type EbayErrorCode =
  (typeof ebayErrorCodes)[keyof typeof ebayErrorCodes];

export class EbayIntegrationError extends AppError {
  constructor(
    public readonly code: EbayErrorCode,
    message: string,
    status = 503,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, status, code);
    this.name = "EbayIntegrationError";
  }

  toPayload() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function toEbayErrorPayload(error: unknown) {
  if (error instanceof EbayIntegrationError) {
    return { payload: error.toPayload(), status: error.status };
  }

  if (error instanceof AppError) {
    return {
      payload: {
        code: error.code ?? ebayErrorCodes.apiFailed,
        message: error.message,
      },
      status: error.status,
    };
  }

  return {
    payload: {
      code: ebayErrorCodes.apiFailed,
      message: "eBay request failed.",
    },
    status: 500,
  };
}
