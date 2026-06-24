import { AppError } from "@/lib/errors";

// Mirrors the eBay error model: a typed, sanitized error surface so route
// handlers never leak raw Etsy payloads, tokens, or stack traces to the client.
export const etsyErrorCodes = {
  notConfigured: "ETSY_NOT_CONFIGURED",
  notEnabled: "ETSY_NOT_ENABLED",
  notConnected: "ETSY_NOT_CONNECTED",
  reconnectRequired: "ETSY_RECONNECT_REQUIRED",
  oauthStateInvalid: "ETSY_OAUTH_STATE_INVALID",
  tokenExchangeFailed: "ETSY_TOKEN_EXCHANGE_FAILED",
  tokenRefreshFailed: "ETSY_TOKEN_REFRESH_FAILED",
  scopeMissing: "ETSY_SCOPE_MISSING",
  rateLimited: "ETSY_RATE_LIMITED",
  readinessFailed: "ETSY_READINESS_FAILED",
  shopMissing: "ETSY_SHOP_MISSING",
  shippingProfileMissing: "ETSY_SHIPPING_PROFILE_MISSING",
  taxonomyMissing: "ETSY_TAXONOMY_MISSING",
  apiFailed: "ETSY_API_FAILED",
  publishNotEnabled: "ETSY_PUBLISH_NOT_ENABLED",
  delistNotEnabled: "ETSY_DELIST_NOT_ENABLED",
  alreadyPublished: "ETSY_ALREADY_PUBLISHED",
  publishFailed: "ETSY_PUBLISH_FAILED",
  imageUploadFailed: "ETSY_IMAGE_UPLOAD_FAILED",
  delistFailed: "ETSY_DELIST_FAILED",
  syncFailed: "ETSY_SYNC_FAILED",
  confirmationRequired: "ETSY_CONFIRMATION_REQUIRED",
} as const;

export type EtsyErrorCode = (typeof etsyErrorCodes)[keyof typeof etsyErrorCodes];

export class EtsyIntegrationError extends AppError {
  constructor(
    public readonly code: EtsyErrorCode,
    message: string,
    status = 503,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, status, code);
    this.name = "EtsyIntegrationError";
  }

  toPayload() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// Map any thrown value to a safe { code, message } payload. Unknown errors never
// expose their message; they collapse to a generic Etsy failure.
export function toEtsyErrorPayload(error: unknown) {
  if (error instanceof EtsyIntegrationError) {
    return { payload: error.toPayload(), status: error.status };
  }

  if (error instanceof AppError) {
    return {
      payload: {
        code: error.code ?? etsyErrorCodes.apiFailed,
        message: error.message,
      },
      status: error.status,
    };
  }

  return {
    payload: {
      code: etsyErrorCodes.apiFailed,
      message: "Etsy request failed.",
    },
    status: 500,
  };
}
