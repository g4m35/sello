import type { ItemCondition } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

import { EbaySandboxClient, getUsableEbayAccessToken } from "./client";
import {
  getEbayConfig,
  getEbayEnvironment,
  isEbayProductionPublishEnabled,
  isEbaySandboxPublishEnabled,
} from "./config";
import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import {
  validateEbayListingReadiness,
  type EbayListingReadinessResult,
} from "./listing-readiness";
import {
  buildEbayInventoryItemPayload,
  buildEbayOfferPayload,
  resolveEbaySku,
  type EbayInventoryItemPayload,
  type EbayOfferPayload,
} from "./mapper";
import { resolveEbayPhotoUrls } from "./media";
import { preflightEbayListing } from "./preflight";
import type { EbayConfig, EbayMarketplaceId } from "./types";

// Guarded publish orchestrator. Real eBay calls are blocked unless the
// environment-specific publish flag is explicitly enabled. Production defaults
// off and remains unavailable unless EBAY_PRODUCTION_PUBLISH_ENABLED === "true".
// When disabled, this returns a typed "not_enabled" result and makes zero
// outbound eBay requests.
// Dependencies are injected so tests run the whole flow without network access.

type EbayEnv = Record<string, string | undefined>;

type DraftRow = {
  title: string | null;
  description: string | null;
  recommendedPriceCents: number | null;
  itemSpecifics: unknown;
  marketplaceDrafts: unknown;
};

type ItemRow = {
  id: string;
  sellerId: string;
  brand: string | null;
  condition: ItemCondition;
  size: string | null;
  colorway: string | null;
  listingDrafts: DraftRow[];
  photos: { storageBucket: string; storagePath: string }[];
};

type ConnectionRow = {
  id: string;
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
};

type SellerConfigRow = {
  marketplaceId: string;
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
} | null;

export type EbayPublishPrismaLike = {
  inventoryItem: {
    findFirst(args: {
      where: { id: string; sellerId: string };
      include?: unknown;
      select?: unknown;
    }): Promise<ItemRow | null>;
  };
  marketplaceConnection: {
    findUnique(args: {
      where: {
        userId_marketplace_environment: {
          userId: string;
          marketplace: "ebay";
          environment: "sandbox" | "production";
        };
      };
    }): Promise<ConnectionRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  ebaySellerConfig: {
    findFirst(args: {
      where: { userId: string; marketplaceConnectionId: string };
    }): Promise<SellerConfigRow>;
  };
};

export type EbayPublishClient = {
  createOrReplaceInventoryItem(
    sku: string,
    payload: EbayInventoryItemPayload,
  ): Promise<void>;
  createOffer(payload: EbayOfferPayload): Promise<{ offerId: string }>;
  publishOffer(offerId: string): Promise<{ listingId: string }>;
};

export type EbayPublishDeps = {
  env: EbayEnv;
  resolveAccessToken: (
    prisma: EbayPublishPrismaLike,
    connection: ConnectionRow,
    config: EbayConfig,
  ) => Promise<string>;
  createClient: (
    accessToken: string,
    marketplaceId: EbayMarketplaceId,
    environment: "sandbox" | "production",
  ) => EbayPublishClient;
};

export type EbayPublishInput = {
  userId: string;
  inventoryItemId: string;
};

export type EbayPublishNotEnabled = {
  status: "not_enabled";
  code: "EBAY_PUBLISH_NOT_ENABLED";
  marketplace: "ebay";
  environment: "sandbox" | "production";
  message: string;
};

export type EbayPublishSuccess = {
  status: "published";
  code: "EBAY_PUBLISH_SUCCEEDED";
  marketplace: "ebay";
  environment: "sandbox" | "production";
  sku: string;
  offerId: string;
  listingId: string;
  steps: EbayPublishStepRecord[];
};

export type EbayPublishResult = EbayPublishNotEnabled | EbayPublishSuccess;

export type EbayPublishStep = "inventory_item" | "offer" | "publish";

export type EbayPublishStepRecord = {
  step: EbayPublishStep;
  status: "started" | "succeeded" | "failed";
};

export const defaultEbayPublishDeps: EbayPublishDeps = {
  env: process.env,
  resolveAccessToken: (prisma, connection, config) =>
    getUsableEbayAccessToken(prisma, connection, config),
  createClient: (accessToken, marketplaceId, environment) =>
    new EbaySandboxClient(accessToken, marketplaceId, fetch, environment),
};

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function ebayDraftFields(draft: DraftRow | undefined): {
  categoryId: string | null;
  quantity: number | null;
} {
  if (
    !draft ||
    !draft.marketplaceDrafts ||
    typeof draft.marketplaceDrafts !== "object"
  ) {
    return { categoryId: null, quantity: null };
  }
  const ebay = (draft.marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") {
    return { categoryId: null, quantity: null };
  }
  const record = ebay as Record<string, unknown>;
  return {
    categoryId: typeof record.categoryId === "string" ? record.categoryId : null,
    quantity: typeof record.quantity === "number" ? record.quantity : null,
  };
}

export async function publishEbayListing(
  prisma: EbayPublishPrismaLike,
  input: EbayPublishInput,
  deps: EbayPublishDeps = defaultEbayPublishDeps,
): Promise<EbayPublishResult> {
  const environment = getEbayEnvironment(deps.env);

  // Hard gates first: when publishing is disabled, return immediately and make
  // no eBay API calls of any kind.
  if (environment === "production" && !isEbayProductionPublishEnabled(deps.env)) {
    return {
      status: "not_enabled",
      code: ebayErrorCodes.publishNotEnabled,
      marketplace: "ebay",
      environment: "production",
      message:
        "Production eBay publishing is not enabled yet. Nothing was published.",
    };
  }

  if (environment === "sandbox" && !isEbaySandboxPublishEnabled(deps.env)) {
    return {
      status: "not_enabled",
      code: ebayErrorCodes.publishNotEnabled,
      marketplace: "ebay",
      environment: "sandbox",
      message:
        "eBay sandbox publishing is disabled. Set EBAY_SANDBOX_PUBLISH_ENABLED=true locally to enable it. Nothing was published.",
    };
  }

  const config = getEbayConfig(deps.env);

  const preflight = await preflightEbayListing(prisma, input, deps.env);
  if (!preflight.ready || !preflight.preview) {
    if (preflight.missing.includes("ebay_connection")) {
      throw new EbayIntegrationError(
        ebayErrorCodes.notConnected,
        `Connect eBay ${environment} before publishing.`,
        404,
      );
    }
    throw new EbayIntegrationError(
      ebayErrorCodes.readinessFailed,
      `Listing is not ready for eBay ${environment} publish. Nothing was published.`,
      422,
      { missing: preflight.missing },
    );
  }

  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, sellerId: input.userId },
    include: {
      listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
      photos: { orderBy: { position: "asc" } },
    },
  });

  if (!item) {
    throw new AppError("Inventory item not found.", 404);
  }

  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      userId_marketplace_environment: {
        userId: input.userId,
        marketplace: "ebay",
        environment,
      },
    },
  });

  if (!connection) {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConnected,
      `Connect eBay ${environment} before publishing.`,
      404,
    );
  }

  const sellerConfig = await prisma.ebaySellerConfig.findFirst({
    where: { userId: input.userId, marketplaceConnectionId: connection.id },
  });

  const draft = item.listingDrafts[0];
  const { categoryId: savedCategoryId, quantity } = ebayDraftFields(draft);
  const categoryId =
    savedCategoryId && savedCategoryId.trim().length > 0
      ? savedCategoryId
      : preflight.preview.offer.categoryId;
  const resolvedQuantity = quantity ?? 1;
  const photos = resolveEbayPhotoUrls(item.photos, deps.env).photos;

  const readiness: EbayListingReadinessResult = validateEbayListingReadiness({
    userId: input.userId,
    item: { id: item.id, sellerId: item.sellerId, condition: item.condition },
    draft: {
      title: draft?.title ?? null,
      description: draft?.description ?? null,
      priceCents: draft?.recommendedPriceCents ?? null,
      quantity: resolvedQuantity,
      categoryId,
    },
    photos,
    connection: { id: connection.id },
    sellerConfig,
  });

  if (!readiness.ready) {
    throw new EbayIntegrationError(
      ebayErrorCodes.readinessFailed,
      `Listing is not ready for eBay ${environment} publish. Nothing was published.`,
      422,
      { missing: readiness.missing },
    );
  }

  // sellerConfig and draft are guaranteed present; readiness would have failed.
  const checkedConfig = sellerConfig!;
  const checkedDraft = draft!;
  const mapperInput = {
    item: {
      id: item.id,
      sellerId: item.sellerId,
      brand: item.brand,
      condition: item.condition,
      size: item.size,
      colorway: item.colorway,
      sku: null,
    },
    draft: {
      title: checkedDraft.title!,
      description: checkedDraft.description!,
      priceCents: checkedDraft.recommendedPriceCents!,
      quantity: resolvedQuantity,
      categoryId,
      itemSpecifics: asStringRecord(checkedDraft.itemSpecifics),
    },
    photos,
    sellerConfig: {
      marketplaceId: checkedConfig.marketplaceId as EbayMarketplaceId,
      paymentPolicyId: checkedConfig.paymentPolicyId,
      fulfillmentPolicyId: checkedConfig.fulfillmentPolicyId,
      returnPolicyId: checkedConfig.returnPolicyId,
      merchantLocationKey: checkedConfig.merchantLocationKey,
    },
  };

  const sku = preflight.preview.sku || resolveEbaySku(mapperInput.item);
  const inventoryPayload =
    preflight.preview.inventoryItem || buildEbayInventoryItemPayload(mapperInput);
  const offerPayload = preflight.preview.offer || buildEbayOfferPayload(mapperInput);

  const accessToken = await deps.resolveAccessToken(prisma, connection, config);
  const client = deps.createClient(accessToken, config.marketplaceId, environment);
  const stepEvents: EbayPublishStepRecord[] = [];

  await runStep("inventory_item", stepEvents, () =>
    client.createOrReplaceInventoryItem(sku, inventoryPayload),
  );
  const { offerId } = await runStep("offer", stepEvents, () =>
    client.createOffer(offerPayload),
  );
  const { listingId } = await runStep("publish", stepEvents, () =>
    client.publishOffer(offerId),
  );

  return {
    status: "published",
    code: "EBAY_PUBLISH_SUCCEEDED",
    marketplace: "ebay",
    environment,
    sku,
    offerId,
    listingId,
    steps: stepEvents,
  };
}

// Tags the failing external step onto the error so the publish handler can
// persist a precise failed MarketplaceEvent. Re-throws typed errors with the
// step detail attached; never swallows.
async function runStep<T>(
  step: EbayPublishStep,
  stepEvents: EbayPublishStepRecord[],
  fn: () => Promise<T>,
): Promise<T> {
  stepEvents.push({ step, status: "started" });
  try {
    const result = await fn();
    stepEvents.push({ step, status: "succeeded" });
    return result;
  } catch (error) {
    stepEvents.push({ step, status: "failed" });
    if (error instanceof EbayIntegrationError) {
      throw new EbayIntegrationError(error.code, error.message, error.status, {
        ...(error.details ?? {}),
        step,
        stepEvents,
        startedSteps: stepEvents
          .filter((event) => event.status === "started")
          .map((event) => event.step),
        succeededSteps: stepEvents
          .filter((event) => event.status === "succeeded")
          .map((event) => event.step),
      });
    }
    throw new EbayIntegrationError(
      ebayErrorCodes.publishFailed,
      "eBay sandbox publish step failed.",
      502,
      { step, stepEvents },
    );
  }
}
