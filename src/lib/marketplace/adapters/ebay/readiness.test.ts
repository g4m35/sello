import { describe, expect, it } from "vitest";

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
        if (where.userId_marketplace_environment.userId !== "user-1") return null;
        return connection
          ? {
              id: connection.id,
              userId: "user-1",
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
    await expect(getStoredEbayReadiness(createPrisma(null), "user-1")).resolves.toMatchObject({
      marketplace: "ebay",
      environment: "sandbox",
      connected: false,
      ready: false,
      missing: ["oauth_connection"],
    });
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
    });

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
    });

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
