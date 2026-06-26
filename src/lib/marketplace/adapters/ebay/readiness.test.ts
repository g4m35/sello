import { describe, expect, it } from "vitest";

import { EbayIntegrationError, ebayErrorCodes } from "./errors";
import {
  getStoredEbayReadiness,
  refreshEbayReadiness,
  type EbayReadinessPrismaLike,
} from "./readiness";

function createPrisma(connection: null | { id: string } = { id: "connection-1" }) {
  const configRows: unknown[] = [];
  const prisma: EbayReadinessPrismaLike & { configRows: unknown[] } = {
    configRows,
    marketplaceConnection: {
      async findUnique({ where }) {
        if (
          where.accountId_marketplace_environment?.accountId &&
          where.accountId_marketplace_environment.accountId !== "acc-1"
        ) {
          return null;
        }
        if (
          where.userId_marketplace_environment?.userId &&
          where.userId_marketplace_environment.userId !== "user-1"
        ) {
          return null;
        }
        return connection
          ? {
              id: connection.id,
              userId: "user-1",
              accountId: "acc-1",
              marketplace: "ebay",
              environment: "sandbox",
              accessTokenEnc: "enc",
              refreshTokenEnc: "enc",
              accessTokenExpiresAt: new Date(Date.now() + 60_000),
              refreshTokenExpiresAt: null,
              scopes: [],
            }
          : null;
      },
    },
    ebaySellerConfig: {
      async findFirst() {
        return null;
      },
      async upsert({ create }) {
        configRows.push(create);
        return create;
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
  };
  return prisma;
}

describe("eBay readiness", () => {
  it("reports a missing connection without requiring eBay config", async () => {
    await expect(
      getStoredEbayReadiness(createPrisma(null), "user-1", "sandbox"),
    ).resolves.toMatchObject({
      marketplace: "ebay",
      environment: "sandbox",
      connected: false,
      ready: false,
      missing: ["oauth_connection"],
    });
  });

  it("scopes the connection lookup to the requested environment", async () => {
    const environments: string[] = [];
    const prisma = createPrisma(null);
    const findUnique = prisma.marketplaceConnection.findUnique.bind(
      prisma.marketplaceConnection,
    );
    prisma.marketplaceConnection.findUnique = async (args) => {
      environments.push(
        args.where.userId_marketplace_environment?.environment ??
          args.where.accountId_marketplace_environment?.environment ??
          "missing",
      );
      return findUnique(args);
    };

    await expect(
      getStoredEbayReadiness(prisma, "user-1", "production"),
    ).resolves.toMatchObject({
      environment: "production",
      connected: false,
    });
    expect(environments).toEqual(["production"]);
  });

  it("maps eBay 4xx policy errors to missing items instead of failing", async () => {
    const fourOhThree = () =>
      Promise.reject(
        new EbayIntegrationError(ebayErrorCodes.apiFailed, "eBay API request failed (HTTP 403).", 502, {
          status: 403,
        }),
      );
    const result = await refreshEbayReadiness(createPrisma(), "user-1", {
      listPaymentPolicies: fourOhThree,
      listFulfillmentPolicies: fourOhThree,
      listReturnPolicies: fourOhThree,
      async listInventoryLocations() {
        return [{ merchantLocationKey: "warehouse-1", merchantLocationStatus: "ENABLED" }];
      },
    }, "sandbox");

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      "payment_policy",
      "fulfillment_policy",
      "return_policy",
    ]);
    expect(result.config.hasInventoryLocation).toBe(true);
  });

  it("propagates eBay 5xx failures as typed errors", async () => {
    const fiveHundred = () =>
      Promise.reject(
        new EbayIntegrationError(ebayErrorCodes.apiFailed, "eBay API request failed (HTTP 500).", 502, {
          status: 500,
        }),
      );

    await expect(
      refreshEbayReadiness(createPrisma(), "user-1", {
        listPaymentPolicies: fiveHundred,
        listFulfillmentPolicies: fiveHundred,
        listReturnPolicies: fiveHundred,
        async listInventoryLocations() {
          return [];
        },
      }, "sandbox"),
    ).rejects.toMatchObject({ code: "EBAY_API_FAILED" });
  });

  it("propagates reconnect-required errors untouched", async () => {
    const reconnect = () =>
      Promise.reject(
        new EbayIntegrationError(
          ebayErrorCodes.reconnectRequired,
          "Reconnect your eBay account.",
          409,
          { status: 401 },
        ),
      );

    await expect(
      refreshEbayReadiness(createPrisma(), "user-1", {
        listPaymentPolicies: reconnect,
        listFulfillmentPolicies: reconnect,
        listReturnPolicies: reconnect,
        async listInventoryLocations() {
          return [];
        },
      }, "sandbox"),
    ).rejects.toMatchObject({ code: "EBAY_RECONNECT_REQUIRED" });
  });

  it("reports missing payment policies as a typed readiness gap", async () => {
    const result = await refreshEbayReadiness(createPrisma(), "user-1", {
      async listPaymentPolicies() {
        return [];
      },
      async listFulfillmentPolicies() {
        return [{ fulfillmentPolicyId: "fulfillment-1" }];
      },
      async listReturnPolicies() {
        return [{ returnPolicyId: "return-1" }];
      },
      async listInventoryLocations() {
        return [{ merchantLocationKey: "warehouse-1", merchantLocationStatus: "ENABLED" }];
      },
    }, "sandbox");

    expect(result.ready).toBe(false);
    expect(result.missing).toContain("payment_policy");
    expect(result.config.hasPaymentPolicy).toBe(false);
  });

  it("stores default policy and location IDs when readiness succeeds", async () => {
    const prisma = createPrisma();
    const result = await refreshEbayReadiness(prisma, "user-1", {
      async listPaymentPolicies() {
        return [{ paymentPolicyId: "payment-1" }];
      },
      async listFulfillmentPolicies() {
        return [{ fulfillmentPolicyId: "fulfillment-1" }];
      },
      async listReturnPolicies() {
        return [{ returnPolicyId: "return-1" }];
      },
      async listInventoryLocations() {
        return [{ merchantLocationKey: "warehouse-1", merchantLocationStatus: "ENABLED" }];
      },
    }, "sandbox");

    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(prisma.configRows[0]).toMatchObject({
      paymentPolicyId: "payment-1",
      fulfillmentPolicyId: "fulfillment-1",
      returnPolicyId: "return-1",
      merchantLocationKey: "warehouse-1",
      readinessStatus: "READY",
    });
  });
});
