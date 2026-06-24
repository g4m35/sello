// Etsy Open API v3 domain types used across the gated integration. These are the
// minimal shapes Sello relies on; raw Etsy responses are never passed to the UI.

export type EtsyConfig = {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  apiBaseUrl: string;
  scopes: string[];
  tokenEncryptionKey: string;
};

// Etsy has a single live environment (no sandbox). We still stamp a constant so
// the shared MarketplaceConnection/MarketplaceListing unique keys stay consistent
// with the other adapters.
export const ETSY_ENVIRONMENT = "production" as const;
export type EtsyEnvironment = typeof ETSY_ENVIRONMENT;

export type EtsyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in: number;
};

export type EtsyConnectionState = {
  connected: boolean;
  reconnectRequired: boolean;
  apiEnabled: boolean;
  connectAllowed: boolean;
  publishAllowed: boolean;
  delistAllowed: boolean;
  scopes: string[];
};

export type EtsyReadinessRequirement =
  | "api_enabled"
  | "connection"
  | "shop"
  | "taxonomy"
  | "shipping_profile"
  | "return_policy"
  | "title"
  | "description"
  | "price"
  | "quantity"
  | "photos";

export type EtsyReadinessResponse = {
  apiEnabled: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  ready: boolean;
  missing: EtsyReadinessRequirement[];
  // When the API path is unavailable, the seller can still use copy-ready export.
  copyReadyAvailable: boolean;
};
