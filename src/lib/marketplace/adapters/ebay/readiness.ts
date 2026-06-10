import type { Marketplace } from "@/generated/prisma/client";

import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type {
  EbayApiClient,
  EbayEnvironment,
  EbayFulfillmentPolicy,
  EbayInventoryLocation,
  EbayPaymentPolicy,
  EbayReadinessResponse,
  EbayReturnPolicy,
} from "./types";

type EbayConnection = {
  id: string;
  userId: string;
  marketplace: Marketplace | "ebay";
  environment: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
};

type EbaySellerConfigRow = {
  marketplaceId: string;
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
  readinessStatus: string | null;
  readinessCheckedAt: Date | null;
} | null;

export type EbayReadinessPrismaLike = {
  marketplaceConnection: {
    findUnique(args: {
      where: {
        userId_marketplace_environment: {
          userId: string;
          marketplace: "ebay";
          environment: EbayEnvironment;
        };
      };
    }): Promise<EbayConnection | null>;
  };
  ebaySellerConfig: {
    findFirst(args: {
      where: { userId: string; marketplaceConnectionId: string };
    }): Promise<EbaySellerConfigRow>;
    upsert(args: {
      where: {
        userId_marketplaceConnectionId: {
          userId: string;
          marketplaceConnectionId: string;
        };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
    deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
  };
};

const missingConnection = "oauth_connection";

// Structured "reconnect required" readiness result: the seller's eBay token is
// expired or revoked. Returned with HTTP 200 so the UI can render an
// actionable state instead of a generic API failure.
export function ebayReconnectRequiredResponse(
  environment: EbayEnvironment,
): EbayReadinessResponse {
  return {
    marketplace: "ebay",
    environment,
    connected: false,
    ready: false,
    reconnectRequired: true,
    missing: [missingConnection],
    config: {
      marketplaceId: "EBAY_US",
      hasPaymentPolicy: false,
      hasFulfillmentPolicy: false,
      hasReturnPolicy: false,
      hasInventoryLocation: false,
    },
    error: {
      code: ebayErrorCodes.reconnectRequired,
      message:
        "Your eBay connection has expired or was revoked. Reconnect your eBay account.",
    },
  };
}
const missingPaymentPolicy = "payment_policy";
const missingFulfillmentPolicy = "fulfillment_policy";
const missingReturnPolicy = "return_policy";
const missingInventoryLocation = "inventory_location";

export async function getStoredEbayReadiness(
  prisma: EbayReadinessPrismaLike,
  userId: string,
  environment: EbayEnvironment,
): Promise<EbayReadinessResponse> {
  const connection = await findConnection(prisma, userId, environment);

  if (!connection) {
    return toResponse({
      connected: false,
      missing: [missingConnection],
      row: null,
      environment,
    });
  }

  const row = await prisma.ebaySellerConfig.findFirst({
    where: { userId, marketplaceConnectionId: connection.id },
  });

  return toResponse({
    connected: true,
    missing: getMissingFromRow(row),
    row,
    environment,
  });
}

export async function refreshEbayReadiness(
  prisma: EbayReadinessPrismaLike,
  userId: string,
  client: EbayApiClient,
  environment: EbayEnvironment,
): Promise<EbayReadinessResponse> {
  const connection = await findConnection(prisma, userId, environment);
  if (!connection) {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConnected,
      "Connect eBay before checking readiness.",
      404,
    );
  }

  const [paymentPolicies, fulfillmentPolicies, returnPolicies, locations] =
    await Promise.all([
      listOrEmpty(() => client.listPaymentPolicies()),
      listOrEmpty(() => client.listFulfillmentPolicies()),
      listOrEmpty(() => client.listReturnPolicies()),
      listOrEmpty(() => client.listInventoryLocations()),
    ]);

  const paymentPolicyId = firstId(paymentPolicies, "paymentPolicyId");
  const fulfillmentPolicyId = firstId(
    fulfillmentPolicies,
    "fulfillmentPolicyId",
  );
  const returnPolicyId = firstId(returnPolicies, "returnPolicyId");
  const merchantLocationKey = firstEnabledLocation(locations);
  const missing = [
    ...(paymentPolicyId ? [] : [missingPaymentPolicy]),
    ...(fulfillmentPolicyId ? [] : [missingFulfillmentPolicy]),
    ...(returnPolicyId ? [] : [missingReturnPolicy]),
    ...(merchantLocationKey ? [] : [missingInventoryLocation]),
  ];
  const now = new Date();
  const row = {
    userId,
    marketplaceConnectionId: connection.id,
    marketplaceId: "EBAY_US",
    paymentPolicyId,
    fulfillmentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    readinessStatus: missing.length === 0 ? "READY" : "INCOMPLETE",
    readinessCheckedAt: now,
  };

  await prisma.ebaySellerConfig.upsert({
    where: {
      userId_marketplaceConnectionId: {
        userId,
        marketplaceConnectionId: connection.id,
      },
    },
    create: row,
    update: row,
  });

  return toResponse({ connected: true, missing, row, environment });
}

// eBay's Account API answers 4xx (typically 403/404) for sellers who have not
// opted into business policies yet. That is an expected setup gap, so it maps
// to "missing", never to a 502. Reconnect-required (revoked token) and eBay
// 5xx errors still propagate: those are not setup gaps.
async function listOrEmpty<T>(list: () => Promise<T[]>): Promise<T[]> {
  try {
    return await list();
  } catch (error) {
    if (
      error instanceof EbayIntegrationError &&
      error.code === ebayErrorCodes.apiFailed &&
      typeof error.details?.status === "number" &&
      error.details.status >= 400 &&
      error.details.status < 500
    ) {
      return [];
    }
    throw error;
  }
}

async function findConnection(
  prisma: EbayReadinessPrismaLike,
  userId: string,
  environment: EbayEnvironment,
) {
  return prisma.marketplaceConnection.findUnique({
    where: {
      userId_marketplace_environment: {
        userId,
        marketplace: "ebay",
        environment,
      },
    },
  });
}

function toResponse(args: {
  connected: boolean;
  missing: string[];
  row: EbaySellerConfigRow;
  environment: EbayEnvironment;
}): EbayReadinessResponse {
  return {
    marketplace: "ebay",
    environment: args.environment,
    connected: args.connected,
    ready: args.connected && args.missing.length === 0,
    missing: args.missing,
    config: {
      marketplaceId: "EBAY_US",
      hasPaymentPolicy: Boolean(args.row?.paymentPolicyId),
      hasFulfillmentPolicy: Boolean(args.row?.fulfillmentPolicyId),
      hasReturnPolicy: Boolean(args.row?.returnPolicyId),
      hasInventoryLocation: Boolean(args.row?.merchantLocationKey),
    },
    ...(args.row?.readinessCheckedAt
      ? { checkedAt: args.row.readinessCheckedAt.toISOString() }
      : {}),
  };
}

function getMissingFromRow(row: EbaySellerConfigRow) {
  if (!row) {
    return [
      missingPaymentPolicy,
      missingFulfillmentPolicy,
      missingReturnPolicy,
      missingInventoryLocation,
    ];
  }

  return [
    ...(row.paymentPolicyId ? [] : [missingPaymentPolicy]),
    ...(row.fulfillmentPolicyId ? [] : [missingFulfillmentPolicy]),
    ...(row.returnPolicyId ? [] : [missingReturnPolicy]),
    ...(row.merchantLocationKey ? [] : [missingInventoryLocation]),
  ];
}

function firstId<T extends EbayPaymentPolicy | EbayFulfillmentPolicy | EbayReturnPolicy>(
  values: T[],
  key: keyof T,
) {
  const value = values.find((item) => typeof item[key] === "string")?.[key];
  return typeof value === "string" ? value : null;
}

function firstEnabledLocation(values: EbayInventoryLocation[]) {
  const location = values.find((item) => {
    const status = item.merchantLocationStatus ?? "ENABLED";
    return status === "ENABLED" && item.merchantLocationKey;
  });

  return location?.merchantLocationKey ?? null;
}
