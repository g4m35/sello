import type { ItemCondition } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

import {
  activateStockXListing,
  createStockXListing,
} from "./client";
import {
  getStockXApiConfig,
  isStockXApiConfigured,
  isStockXListingEnabled,
} from "./config";
import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import {
  buildStockXCreateListingPayload,
  type StockXCreateListingPayload,
} from "./mapper";
import { evaluateStockXListingReadiness } from "./readiness";
import { decryptStockXToken } from "./token-crypto";
import {
  STOCKX_ENVIRONMENT,
  type StockXActivateListingResult,
  type StockXConfig,
  type StockXCreateListingResult,
} from "./types";

type StockXEnv = Record<string, string | undefined>;

type DraftRow = {
  title: string | null;
  recommendedPriceCents: number | null;
  stockxProductId: string | null;
  stockxVariantId: string | null;
  marketplaceDrafts: unknown;
};

type ItemRow = {
  id: string;
  sellerId: string;
  accountId?: string | null;
  condition: ItemCondition;
  quantityAvailable: number;
  recommendedPriceCents?: number | null;
  listingDrafts: DraftRow[];
};

type ConnectionRow = {
  id: string;
  accountId: string;
  externalUserId: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
};

export type StockXPublishPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; accountId?: string; sellerId?: string };
      include?: unknown;
    }): Promise<ItemRow | null>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        accountId_marketplace_environment?: {
          accountId: string;
          marketplace: "stockx";
          environment: typeof STOCKX_ENVIRONMENT;
        };
        userId_marketplace_environment?: {
          userId: string;
          marketplace: "stockx";
          environment: typeof STOCKX_ENVIRONMENT;
        };
      };
      select?: unknown;
    }): Promise<ConnectionRow | null>;
  };
};

export type StockXPublishClient = {
  createListing(
    payload: StockXCreateListingPayload,
  ): Promise<StockXCreateListingResult>;
  activateListing(listingId: string): Promise<StockXActivateListingResult>;
};

export type StockXPublishDeps = {
  env: StockXEnv;
  resolveAccessToken: (
    connection: ConnectionRow,
    config: StockXConfig,
  ) => Promise<string> | string;
  createClient: (
    accessToken: string,
    config: StockXConfig,
  ) => StockXPublishClient;
};

export type StockXPublishInput = {
  userId: string;
  accountId?: string;
  inventoryItemId: string;
  confirmLivePublish?: boolean;
};

export type StockXPublishNotEnabled = {
  status: "not_enabled";
  code: typeof stockxErrorCodes.listingNotEnabled;
  marketplace: "stockx";
  environment: typeof STOCKX_ENVIRONMENT;
  message: string;
};

export type StockXPublishSubmitted = {
  status: "submitted";
  code: typeof stockxErrorCodes.listingSubmitted;
  marketplace: "stockx";
  environment: typeof STOCKX_ENVIRONMENT;
  listingId: string;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
  listingUrl: string | null;
};

export type StockXPublishSuccess = {
  status: "published";
  code: typeof stockxErrorCodes.listingSucceeded;
  marketplace: "stockx";
  environment: typeof STOCKX_ENVIRONMENT;
  listingId: string;
  operationId: string | null;
  operationStatus: string | null;
  operationUrl: string | null;
  listingUrl: string | null;
};

export type StockXPublishResult =
  | StockXPublishNotEnabled
  | StockXPublishSubmitted
  | StockXPublishSuccess;

export const defaultStockXPublishDeps: StockXPublishDeps = {
  env: process.env,
  resolveAccessToken: (connection, config) =>
    decryptStockXToken(connection.accessTokenEnc, config.tokenEncryptionKey),
  createClient: (accessToken, config) => ({
    createListing: (payload) => createStockXListing(config, accessToken, payload),
    activateListing: (listingId) =>
      activateStockXListing(config, accessToken, listingId),
  }),
};

export async function publishStockXListing(
  prisma: StockXPublishPrismaLike,
  input: StockXPublishInput,
  deps: StockXPublishDeps = defaultStockXPublishDeps,
): Promise<StockXPublishResult> {
  if (!isStockXListingEnabled(deps.env)) {
    return {
      status: "not_enabled",
      code: stockxErrorCodes.listingNotEnabled,
      marketplace: "stockx",
      environment: STOCKX_ENVIRONMENT,
      message: "StockX listing creation is disabled. Nothing was published.",
    };
  }

  const apiConfigured = isStockXApiConfigured(deps.env);
  const config = getStockXApiConfig(deps.env);

  const item = await prisma.inventoryItem.findFirst({
    where: input.accountId
      ? { id: input.inventoryItemId, accountId: input.accountId }
      : { id: input.inventoryItemId, sellerId: input.userId },
    include: {
      listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  const connection = await prisma.marketplaceConnection.findUnique({
    where: input.accountId
      ? {
          accountId_marketplace_environment: {
            accountId: input.accountId,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
          },
        }
      : {
          userId_marketplace_environment: {
            userId: input.userId,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
          },
        },
    select: {
      id: true,
      accountId: true,
      externalUserId: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
    },
  });

  const draft = item.listingDrafts[0] ?? null;
  const stockxDraft = stockxDraftOf(draft?.marketplaceDrafts);
  const productId = draft?.stockxProductId ?? stringOf(stockxDraft.productId);
  const variantId = draft?.stockxVariantId ?? stringOf(stockxDraft.variantId);
  const priceCents =
    draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null;

  const readiness = evaluateStockXListingReadiness({
    apiConfigured,
    listingEnabled: true,
    connected: Boolean(connection),
    productId,
    variantId,
    priceCents,
    quantityAvailable: item.quantityAvailable,
    confirmed: input.confirmLivePublish === true,
  });
  if (!readiness.ready) {
    const code = readiness.missing.includes("confirmation")
      ? stockxErrorCodes.confirmationRequired
      : stockxErrorCodes.listingReadinessFailed;
    throw new StockXIntegrationError(
      code,
      stockxReadinessMessage(readiness.missing),
      code === stockxErrorCodes.confirmationRequired ? 400 : 422,
      { missing: readiness.missing },
    );
  }

  const accessToken = await deps.resolveAccessToken(connection!, config);
  const client = deps.createClient(accessToken, config);
  const payload = buildStockXCreateListingPayload({ variantId, priceCents });
  const created = await client.createListing(payload);
  const active = isActiveStockXListing(created);
  const listingUrl = stringOf(stockxDraft.url);

  const common = {
    marketplace: "stockx" as const,
    environment: STOCKX_ENVIRONMENT as typeof STOCKX_ENVIRONMENT,
    listingId: created.listingId,
    operationId: created.operationId,
    operationStatus: created.operationStatus,
    operationUrl: created.operationUrl,
    listingUrl,
  };

  if (active) {
    return {
      ...common,
      status: "published",
      code: stockxErrorCodes.listingSucceeded,
    };
  }

  return {
    ...common,
    status: "submitted",
    code: stockxErrorCodes.listingSubmitted,
  };
}

function stockxDraftOf(marketplaceDrafts: unknown): Record<string, unknown> {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return {};
  const stockx = (marketplaceDrafts as Record<string, unknown>).stockx;
  if (!stockx || typeof stockx !== "object" || Array.isArray(stockx)) return {};
  return stockx as Record<string, unknown>;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isActiveStockXListing(
  result: StockXActivateListingResult | StockXCreateListingResult,
): boolean {
  const status = `${result.status ?? ""} ${result.operationStatus ?? ""}`.toUpperCase();
  return /\b(ACTIVE|ACTIVATED|LISTED|SUCCEEDED|SUCCESS)\b/.test(status);
}

function stockxReadinessMessage(missing: string[]): string {
  if (missing.includes("confirmation")) {
    return "Confirm before creating a live StockX listing.";
  }
  if (missing.includes("stockx_connection")) {
    return "Connect StockX before creating a StockX listing.";
  }
  if (missing.includes("stockx_variant_match")) {
    return "Choose an exact StockX size/variant before listing.";
  }
  if (missing.includes("price")) {
    return "Set a listing price before listing on StockX.";
  }
  return "This item is not ready for StockX listing.";
}
