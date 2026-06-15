export type EbayEnvironment = "sandbox" | "production";
export type EbayMarketplaceId = "EBAY_US";

export type EbayConfig = {
  environment: EbayEnvironment;
  clientId: string;
  clientSecret: string;
  redirectUriName: string;
  marketplaceId: EbayMarketplaceId;
  tokenEncryptionKey: string;
};

export type EbayReadinessResponse = {
  marketplace: "ebay";
  environment: EbayEnvironment;
  connected: boolean;
  ready: boolean;
  /** The stored eBay token is expired/revoked; the seller must reconnect. */
  reconnectRequired?: boolean;
  missing: string[];
  config: {
    marketplaceId: EbayMarketplaceId;
    hasPaymentPolicy: boolean;
    hasFulfillmentPolicy: boolean;
    hasReturnPolicy: boolean;
    hasInventoryLocation: boolean;
  };
  checkedAt?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type EbayTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
};

export type EbayTaxonomyAspect = {
  localizedAspectName?: string;
  aspectConstraint?: {
    aspectRequired?: boolean;
    aspectUsage?: string;
    aspectMode?: string;
  };
  aspectValues?: Array<{ localizedValue?: string }>;
};

export type EbayPaymentPolicy = {
  paymentPolicyId?: string;
  name?: string;
};

export type EbayFulfillmentPolicy = {
  fulfillmentPolicyId?: string;
  name?: string;
};

export type EbayReturnPolicy = {
  returnPolicyId?: string;
  name?: string;
};

export type EbayInventoryLocation = {
  merchantLocationKey?: string;
  merchantLocationStatus?: string;
  name?: string;
};

export type EbayInventoryItemLookup = {
  sku?: string;
  product?: {
    title?: string;
    aspects?: Record<string, string[]>;
    imageUrls?: string[];
  };
  availability?: unknown;
  condition?: string;
};

export type EbayOfferLookup = {
  offerId?: string;
  sku?: string;
  marketplaceId?: EbayMarketplaceId | string;
  format?: string;
  listing?: {
    listingId?: string;
    listingStatus?: string;
    soldQuantity?: number;
  };
  status?: string;
};

// Request body for createInventoryLocation
// (POST /sell/inventory/v1/location/{merchantLocationKey}).
export type EbayInventoryLocationPayload = {
  name: string;
  location: {
    address: {
      addressLine1: string;
      addressLine2?: string;
      city: string;
      stateOrProvince: string;
      postalCode: string;
      country: string;
    };
  };
  locationTypes: ["WAREHOUSE"];
  merchantLocationStatus: "ENABLED";
  phone?: string;
};

export type EbayApiClient = {
  listPaymentPolicies(): Promise<EbayPaymentPolicy[]>;
  listFulfillmentPolicies(): Promise<EbayFulfillmentPolicy[]>;
  listReturnPolicies(): Promise<EbayReturnPolicy[]>;
  listInventoryLocations(): Promise<EbayInventoryLocation[]>;
};
