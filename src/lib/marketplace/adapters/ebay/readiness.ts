import type { Marketplace } from "@/generated/prisma/client";

import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import type {
  EbayApiClient,
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
          environment: "sandbox";
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
const missingPaymentPolicy = "payment_policy";
const missingFulfillmentPolicy = "fulfillment_policy";
const missingReturnPolicy = "return_policy";
const missingInventoryLocation = "inventory_location";

export async function getStoredEbayReadiness(
  prisma: EbayReadinessPrismaLike,
  userId: string,
): Promise<EbayReadinessResponse> {
  const connection = await findConnection(prisma, userId);

  if (!connection) {
    return toResponse({
      connected: false,
      missing: [missingConnection],
      row: null,
    });
  }

  const row = await prisma.ebaySellerConfig.findFirst({
    where: { userId, marketplaceConnectionId: connection.id },
  });

  return toResponse({
    connected: true,
    missing: getMissingFromRow(row),
    row,
  });
}

export async function refreshEbayReadiness(
  prisma: EbayReadinessPrismaLike,
  userId: string,
  client: EbayApiClient,
): Promise<EbayReadinessResponse> {
  const connection = await findConnection(prisma, userId);
  if (!connection) {
    throw new EbayIntegrationError(
      ebayErrorCodes.notConnected,
      "Connect eBay sandbox before checking readiness.",
      404,
    );
  }

  const [paymentPolicies, fulfillmentPolicies, returnPolicies, locations] =
    await Promise.all([
      client.listPaymentPolicies(),
      client.listFulfillmentPolicies(),
      client.listReturnPolicies(),
      client.listInventoryLocations(),
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

  return toResponse({ connected: true, missing, row });
}

async function findConnection(prisma: EbayReadinessPrismaLike, userId: string) {
  return prisma.marketplaceConnection.findUnique({
    where: {
      userId_marketplace_environment: {
        userId,
        marketplace: "ebay",
        environment: "sandbox",
      },
    },
  });
}

function toResponse(args: {
  connected: boolean;
  missing: string[];
  row: EbaySellerConfigRow;
}): EbayReadinessResponse {
  return {
    marketplace: "ebay",
    environment: "sandbox",
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
