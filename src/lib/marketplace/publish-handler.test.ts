import { describe, expect, it } from "vitest";

import type { InventoryStatus } from "@/generated/prisma/client";

import { executePublish, type PublishPrismaLike } from "./publish-handler";

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
      marketplace: "ebay",
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
      marketplace: "ebay",
    });
    await executePublish(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
      marketplace: "ebay",
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
