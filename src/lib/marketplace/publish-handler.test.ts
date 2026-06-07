import { describe, expect, it, vi } from "vitest";

import type { InventoryStatus } from "@/generated/prisma/client";

import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import {
  executePublish,
  publishingMigrationMissingCode,
  type PublishPrismaLike,
} from "./publish-handler";

type FakeState = {
  listings: Map<string, { id: string; inventoryItemId: string; marketplace: string }>;
  attempts: Array<{
    id: string;
    marketplaceListingId: string;
    status: string;
    code: string;
    reason: string | null;
    requestedBy: string;
    completedAt: Date | null;
  }>;
  events: Array<{ id: string; marketplaceListingId: string; kind: string }>;
};

type FakePrisma = PublishPrismaLike & { _state: FakeState };

function createFakePrisma(opts: {
  itemStatus: InventoryStatus;
  sellerId?: string;
  itemId?: string;
  missingTable?: "PublishAttempt" | "MarketplaceEvent";
}): FakePrisma {
  const sellerId = opts.sellerId ?? "user-1";
  const itemId = opts.itemId ?? "item-1";
  const state: FakeState = {
    listings: new Map(),
    attempts: [],
    events: [],
  };

  return {
    _state: state,
    inventoryItem: {
      async findFirst({ where }) {
        if (where.id !== itemId || where.sellerId !== sellerId) return null;
        return { id: itemId, status: opts.itemStatus };
      },
    },
    marketplaceListing: {
      async upsert({ where, create }) {
        const key = `${where.inventoryItemId_marketplace.inventoryItemId}|${where.inventoryItemId_marketplace.marketplace}`;
        if (!state.listings.has(key)) {
          const id = `listing-${state.listings.size + 1}`;
          state.listings.set(key, {
            id,
            inventoryItemId: create.inventoryItemId,
            marketplace: create.marketplace,
          });
        }
        return { id: state.listings.get(key)!.id };
      },
    },
    publishAttempt: {
      async create({ data }) {
        if (opts.missingTable === "PublishAttempt") {
          throw {
            code: "P2021",
            message: 'The table `public.PublishAttempt` does not exist.',
          };
        }

        const id = `attempt-${state.attempts.length + 1}`;
        state.attempts.push({
          id,
          marketplaceListingId: data.marketplaceListingId,
          status: data.status,
          code: data.code,
          reason: data.reason ?? null,
          requestedBy: data.requestedBy,
          completedAt: data.completedAt ?? null,
        });
        return { id };
      },
    },
    marketplaceEvent: {
      async create({ data }) {
        if (opts.missingTable === "MarketplaceEvent") {
          throw {
            code: "42P01",
            message: 'relation "MarketplaceEvent" does not exist',
          };
        }

        const id = `event-${state.events.length + 1}`;
        state.events.push({
          id,
          marketplaceListingId: data.marketplaceListingId,
          kind: data.kind,
        });
        return { id };
      },
    },
  };
}

describe("executePublish", () => {
  it("creates a MarketplaceListing + PublishAttempt + event for an approved item", async () => {
    const prisma = createFakePrisma({ itemStatus: "APPROVED" });

    const result = await executePublish(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
      marketplace: "grailed",
    });

    expect(result.httpStatus).toBe(501);
    expect(result.outcome.code).toBe("NOT_IMPLEMENTED");
    expect(result.marketplaceListingId).toBe("listing-1");
    expect(prisma._state.listings.size).toBe(1);
    expect(prisma._state.attempts).toHaveLength(1);
    expect(prisma._state.events).toHaveLength(1);
    expect(prisma._state.events[0].kind).toBe("publish_attempted");
  });

  it("is idempotent: repeated publish reuses the MarketplaceListing", async () => {
    const prisma = createFakePrisma({ itemStatus: "APPROVED" });

    await executePublish(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
      marketplace: "grailed",
    });
    await executePublish(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
      marketplace: "grailed",
    });

    expect(prisma._state.listings.size).toBe(1);
    expect(prisma._state.attempts).toHaveLength(2);
    expect(prisma._state.attempts[0].marketplaceListingId).toBe(
      prisma._state.attempts[1].marketplaceListingId,
    );
  });

  it("blocks an unapproved item with a 409 typed error and writes nothing", async () => {
    const prisma = createFakePrisma({ itemStatus: "DRAFT_READY" });

    await expect(
      executePublish(prisma, {
        userId: "user-1",
        inventoryItemId: "item-1",
        marketplace: "ebay",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(prisma._state.listings.size).toBe(0);
    expect(prisma._state.attempts).toHaveLength(0);
    expect(prisma._state.events).toHaveLength(0);
  });

  it("blocks a sold item with a 409 typed error", async () => {
    const prisma = createFakePrisma({ itemStatus: "SOLD" });

    await expect(
      executePublish(prisma, {
        userId: "user-1",
        inventoryItemId: "item-1",
        marketplace: "ebay",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("records the attempt as NOT_IMPLEMENTED with code and requester", async () => {
    const prisma = createFakePrisma({ itemStatus: "APPROVED" });

    await executePublish(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
      marketplace: "grailed",
    });

    const attempt = prisma._state.attempts[0];
    expect(attempt.status).toBe("NOT_IMPLEMENTED");
    expect(attempt.code).toBe("NOT_IMPLEMENTED");
    expect(attempt.requestedBy).toBe("user-1");
    expect(attempt.completedAt).toBeInstanceOf(Date);
  });

  it("returns a typed setup error when PublishAttempt is missing in the database", async () => {
    const prisma = createFakePrisma({
      itemStatus: "APPROVED",
      missingTable: "PublishAttempt",
    });

    await expect(
      executePublish(prisma, {
        userId: "user-1",
        inventoryItemId: "item-1",
        marketplace: "ebay",
      }),
    ).rejects.toMatchObject({
      code: publishingMigrationMissingCode,
      status: 503,
      missingTables: ["PublishAttempt", "MarketplaceEvent"],
    });

    expect(prisma._state.events).toHaveLength(0);
  });

  it("returns a typed setup error when MarketplaceEvent is missing in the database", async () => {
    const prisma = createFakePrisma({
      itemStatus: "APPROVED",
      missingTable: "MarketplaceEvent",
    });

    await expect(
      executePublish(prisma, {
        userId: "user-1",
        inventoryItemId: "item-1",
        marketplace: "depop",
      }),
    ).rejects.toMatchObject({
      code: publishingMigrationMissingCode,
      status: 503,
      missingTables: ["PublishAttempt", "MarketplaceEvent"],
    });
  });

  it("rejects an inventory item that does not belong to the seller (404)", async () => {
    const prisma = createFakePrisma({ itemStatus: "APPROVED" });

    await expect(
      executePublish(prisma, {
        userId: "other-user",
        inventoryItemId: "item-1",
        marketplace: "ebay",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

type EbayFakeListing = {
  id: string;
  externalListingId: string | null;
  externalOfferId: string | null;
  sku: string | null;
};

type EbayFakeState = {
  attempts: Array<{ status: string; code: string; reason: string | null }>;
  events: Array<{ kind: string; data: Record<string, unknown> }>;
  updates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  listings: Map<string, EbayFakeListing>;
};

function createEbayFakePrisma(opts?: { existingListing?: Partial<EbayFakeListing> }) {
  const state: EbayFakeState = {
    attempts: [],
    events: [],
    updates: [],
    listings: new Map(),
  };

  const prisma = {
    _state: state,
    inventoryItem: {
      async findFirst({ where }: { where: { id: string; sellerId: string } }) {
        if (where.id !== "item-1" || where.sellerId !== "user-1") return null;
        return { id: "item-1", status: "APPROVED" as InventoryStatus };
      },
    },
    marketplaceListing: {
      async upsert({
        where,
      }: {
        where: { inventoryItemId_marketplace: { inventoryItemId: string; marketplace: string } };
        create: { inventoryItemId: string; marketplace: string };
      }) {
        const k = `${where.inventoryItemId_marketplace.inventoryItemId}|${where.inventoryItemId_marketplace.marketplace}`;
        if (!state.listings.has(k)) {
          state.listings.set(k, {
            id: opts?.existingListing?.id ?? `listing-${state.listings.size + 1}`,
            externalListingId: opts?.existingListing?.externalListingId ?? null,
            externalOfferId: opts?.existingListing?.externalOfferId ?? null,
            sku: opts?.existingListing?.sku ?? null,
          });
        }
        return state.listings.get(k)!;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        state.updates.push({ where, data });
        for (const listing of state.listings.values()) {
          if (listing.id === where.id) {
            listing.externalListingId =
              typeof data.externalListingId === "string"
                ? data.externalListingId
                : listing.externalListingId;
            listing.externalOfferId =
              typeof data.externalOfferId === "string"
                ? data.externalOfferId
                : listing.externalOfferId;
            listing.sku = typeof data.sku === "string" ? data.sku : listing.sku;
          }
        }
        return { id: where.id };
      },
    },
    publishAttempt: {
      async create({
        data,
      }: {
        data: { status: string; code: string; reason: string | null };
      }) {
        state.attempts.push({
          status: data.status,
          code: data.code,
          reason: data.reason ?? null,
        });
        return { id: `attempt-${state.attempts.length}` };
      },
    },
    marketplaceEvent: {
      async create({
        data,
      }: {
        data: { kind: string; data: Record<string, unknown> };
      }) {
        state.events.push({ kind: data.kind, data: data.data });
        return { id: `event-${state.events.length}` };
      },
    },
  };

  return prisma as unknown as PublishPrismaLike & { _state: EbayFakeState };
}

describe("executePublish — eBay dispatch", () => {
  const input = {
    userId: "user-1",
    inventoryItemId: "item-1",
    marketplace: "ebay" as const,
  };

  it("records EBAY_PUBLISH_NOT_ENABLED without listing the item when publishing is disabled", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockResolvedValue({
      status: "not_enabled",
      code: ebayErrorCodes.publishNotEnabled,
      marketplace: "ebay",
      environment: "sandbox",
      message: "disabled",
    });

    const result = await executePublish(prisma, input, undefined, ebayPublish);

    expect(result.outcome.code).toBe(ebayErrorCodes.publishNotEnabled);
    expect(prisma._state.attempts[0].code).toBe(ebayErrorCodes.publishNotEnabled);
    expect(prisma._state.updates).toHaveLength(0);
  });

  it("persists SKU/offerId/listingId and marks the listing LISTED on success", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockResolvedValue({
      status: "published",
      code: "EBAY_PUBLISH_SUCCEEDED",
      marketplace: "ebay",
      environment: "sandbox",
      sku: "percs_item-1",
      offerId: "offer-1",
      listingId: "listing-x",
    });

    const result = await executePublish(prisma, input, undefined, ebayPublish);

    expect(result.outcome.status).toBe("published");
    expect(result.sku).toBe("percs_item-1");
    expect(result.offerId).toBe("offer-1");
    expect(result.listingId).toBe("listing-x");

    expect(prisma._state.attempts[0].status).toBe("SUCCEEDED");
    const update = prisma._state.updates[0];
    expect(update.data.sku).toBe("percs_item-1");
    expect(update.data.externalOfferId).toBe("offer-1");
    expect(update.data.externalListingId).toBe("listing-x");
    expect(update.data.status).toBe("LISTED");
    expect(prisma._state.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        "ebay_inventory_item_created",
        "ebay_offer_created",
        "ebay_offer_published",
      ]),
    );
  });

  it("blocks duplicate eBay publish when a listing ID already exists", async () => {
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        externalListingId: "ebay-listing-1",
        externalOfferId: "offer-1",
        sku: "percs_item-1",
      },
    });
    const ebayPublish = vi.fn();

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({
      code: ebayErrorCodes.alreadyPublished,
      status: 409,
    });

    expect(ebayPublish).not.toHaveBeenCalled();
    expect(prisma._state.updates).toHaveLength(0);
  });

  it("blocks duplicate eBay publish when an offer ID already exists", async () => {
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        externalListingId: null,
        externalOfferId: "offer-1",
        sku: "percs_item-1",
      },
    });
    const ebayPublish = vi.fn();

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({
      code: ebayErrorCodes.alreadyPublished,
      status: 409,
    });

    expect(ebayPublish).not.toHaveBeenCalled();
  });

  it("allows retry after a pre-API readiness failure when no external IDs exist", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi
      .fn()
      .mockRejectedValueOnce(
        new EbayIntegrationError(
          ebayErrorCodes.readinessFailed,
          "not ready",
          422,
        ),
      )
      .mockResolvedValueOnce({
        status: "not_enabled",
        code: ebayErrorCodes.publishNotEnabled,
        marketplace: "ebay",
        environment: "sandbox",
        message: "disabled",
      });

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({ code: ebayErrorCodes.readinessFailed });

    const retry = await executePublish(prisma, input, undefined, ebayPublish);

    expect(retry.outcome.code).toBe(ebayErrorCodes.publishNotEnabled);
    expect(ebayPublish).toHaveBeenCalledTimes(2);
  });

  it("does not create a second mocked eBay listing after one successful publish", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockResolvedValue({
      status: "published",
      code: "EBAY_PUBLISH_SUCCEEDED",
      marketplace: "ebay",
      environment: "sandbox",
      sku: "percs_item-1",
      offerId: "offer-1",
      listingId: "listing-x",
    });

    await executePublish(prisma, input, undefined, ebayPublish);
    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({ code: ebayErrorCodes.alreadyPublished });

    expect(ebayPublish).toHaveBeenCalledTimes(1);
  });

  it("persists a FAILED attempt and failed event, then rethrows on readiness failure", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi
      .fn()
      .mockRejectedValue(
        new EbayIntegrationError(
          ebayErrorCodes.readinessFailed,
          "not ready",
          422,
          { missing: ["title"] },
        ),
      );

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({ code: ebayErrorCodes.readinessFailed });

    expect(prisma._state.attempts[0].status).toBe("FAILED");
    expect(prisma._state.attempts[0].code).toBe(ebayErrorCodes.readinessFailed);
    expect(prisma._state.events.some((e) => e.kind === "publish_failed")).toBe(true);
    expect(prisma._state.updates).toHaveLength(0);
  });

  it("tags the failing external step on a mid-flow API failure", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi
      .fn()
      .mockRejectedValue(
        new EbayIntegrationError(
          ebayErrorCodes.publishFailed,
          "offer failed",
          502,
          { step: "offer" },
        ),
      );

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({ code: ebayErrorCodes.publishFailed });

    const failed = prisma._state.events.find((e) => e.kind === "publish_failed");
    expect(failed?.data.step).toBe("offer");
  });
});
