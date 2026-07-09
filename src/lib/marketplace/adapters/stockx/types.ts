export const STOCKX_ENVIRONMENT = "production";

export type StockXConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  apiKey: string | null;
  scopes: string[];
  tokenEncryptionKey: string;
};

export type StockXTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
};

export type StockXCatalogCandidate = {
  productId: string;
  variantId: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  style: string | null;
  colorway: string | null;
  color: string | null;
  size: string | null;
  image: string | null;
  category: string | null;
  url: string | null;
};

export type StockXMarketDataPoint = {
  externalId: string | null;
  title: string;
  priceCents: number;
  currency: string;
  soldDate: string | null;
  url: string | null;
  imageUrl: string | null;
  brand: string | null;
  size: string | null;
  category: string | null;
  rawJson: unknown;
};

export type StockXCreateListingResult = {
  listingId: string;
  status: string | null;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
  rawJson: unknown;
};

export type StockXActivateListingResult = {
  listingId: string;
  status: string | null;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
  rawJson: unknown;
};

export type StockXDeactivateListingResult = {
  listingId: string;
  status: string | null;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
  rawJson: unknown;
};

export type StockXListingStatusResult = {
  listingId: string;
  status: string | null;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
  rawJson: unknown;
};

export type StockXStatusCapabilities = {
  connect: boolean;
  catalogSearch: boolean;
  productMatching: boolean;
  marketData: boolean;
  listingCreation: boolean;
  listingSync: boolean;
  orderSync: boolean;
};
