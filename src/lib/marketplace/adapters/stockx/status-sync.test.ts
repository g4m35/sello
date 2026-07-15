import { describe, expect, it, vi } from "vitest";

import { stockxErrorCodes } from "./errors";
import {
  syncStockXListingStatus,
  type StockXStatusSyncDeps,
  type StockXStatusSyncPrismaLike,
} from "./status-sync";

const env = {
  STOCKX_API_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "x".repeat(32),
  STOCKX_OAUTH_STATE_SECRET: "s".repeat(32),
  STOCKX_API_KEY: "api-key",
};

type FakeListing = {
  id: string;
  inventoryItemId: string;
  marketplace: "stockx";
  status: string;
  externalListingId: string | null;
  metadata: unknown;
  inventoryItem: { accountId: string; sellerId: string };
  lastSyncAt: Date | null;
  endedAt: Date | null;
};

function createFake({
  remoteStatus,
  operationStatus = null,
  sellerId = "user-1",
}: {
  remoteStatus: string | null;
  operationStatus?: string | null;
  sellerId?: string;
}) {
  const listing: FakeListing = {
    id: "listing-row-1",
    inventoryItemId: "item-1",
    marketplace: "stockx",
    status: "LISTING",
    externalListingId: "stockx-listing-1",
    metadata: { operationId: "operation-1" },
    inventoryItem: { accountId: "account-1", sellerId },
    lastSyncAt: null,
    endedAt: null,
  };
  const events: Array<{ kind: string; data: unknown }> = [];
  const attempts: Array<{ status: string; code: string }> = [
    { status: "RUNNING", code: stockxErrorCodes.listingSubmitted },
  ];
  const markSold = vi.fn().mockResolvedValue({ outcome: "marked_sold" });
  const fetchListingStatus = vi.fn().mockResolvedValue({
    listingId: "stockx-listing-1",
    status: remoteStatus,
    operationId: "operation-1",
    operationStatus,
    operationUrl:
      "https://api.stockx.com/v2/selling/listings/stockx-listing-1/operations/operation-1",
    rawJson: { secret: "not persisted" },
  });
  const deps: StockXStatusSyncDeps = {
    env,
    resolveAccessToken: () => "access-token",
    createClient: () => ({
      fetchListingStatus,
    }),
    markSold,
  };

  const prisma = {
    marketplaceListing: {
      async findFirst({
        where,
      }: {
        where: {
          id: string;
          marketplace: "stockx";
          inventoryItem: { accountId: string } | { sellerId: string };
        };
      }) {
        if (where.id !== listing.id || where.marketplace !== listing.marketplace) {
          return null;
        }
        if (
          "accountId" in where.inventoryItem &&
          where.inventoryItem.accountId !== listing.inventoryItem.accountId
        ) {
          return null;
        }
        if (
          "sellerId" in where.inventoryItem &&
          where.inventoryItem.sellerId !== listing.inventoryItem.sellerId
        ) {
          return null;
        }
        return listing;
      },
      async update({ data }: { data: Partial<FakeListing> }) {
        Object.assign(listing, data);
        return { id: listing.id };
      },
      async findMany() {
        return [];
      },
    },
    marketplaceConnection: {
      async findUnique() {
        return {
          id: "connection-1",
          accountId: "account-1",
          accessTokenEnc: "encrypted",
          refreshTokenEnc: "encrypted-refresh",
        };
      },
    },
    publishAttempt: {
      async updateMany({
        data,
      }: {
        data: { status: string; code: string };
      }) {
        attempts[0] = { ...attempts[0], ...data };
        return { count: 1 };
      },
    },
    marketplaceEvent: {
      async create({ data }: { data: { kind: string; data: unknown } }) {
        events.push({ kind: data.kind, data: data.data });
        return { id: `event-${events.length}` };
      },
    },
  } as unknown as StockXStatusSyncPrismaLike;

  return {
    prisma,
    listing,
    events,
    attempts,
    markSold,
    fetchListingStatus,
    deps,
  };
}

describe("syncStockXListingStatus", () => {
  it("settles an active StockX listing and completes the running publish attempt", async () => {
    const { prisma, listing, events, attempts, markSold, deps } = createFake({
      remoteStatus: "ACTIVE",
      operationStatus: "SUCCEEDED",
    });

    const result = await syncStockXListingStatus(prisma, {
      userId: "user-1",
      marketplaceListingId: "listing-row-1",
    }, deps);

    expect(result.status).toBe("active");
    expect(listing.status).toBe("LISTED");
    expect(listing.lastSyncAt).toBeInstanceOf(Date);
    expect(attempts[0]).toMatchObject({
      status: "SUCCEEDED",
      code: stockxErrorCodes.listingSucceeded,
    });
    expect(events.map((event) => event.kind)).toContain("stockx_listing_active");
    expect(markSold).not.toHaveBeenCalled();
    expect(JSON.stringify(listing.metadata)).not.toContain("not persisted");
  });

  it("routes sold status through the inventory sold safety path", async () => {
    const { prisma, listing, events, markSold, deps } = createFake({
      remoteStatus: "SOLD",
    });

    const result = await syncStockXListingStatus(prisma, {
      userId: "user-1",
      marketplaceListingId: "listing-row-1",
    }, deps);

    expect(result.status).toBe("sold");
    expect(listing.status).toBe("SOLD");
    expect(markSold).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        inventoryItemId: "item-1",
        accountId: "account-1",
        inventoryOwnerUserId: "user-1",
        soldMarketplace: "stockx",
        soldListingId: "stockx-listing-1",
        sourceMarketplaceListingId: "listing-row-1",
        source: "api",
      }),
    );
    expect(events.map((event) => event.kind)).toContain("stockx_listing_sold");
  });

  it("marks the owning seller's inventory sold when status sync runs as a teammate", async () => {
    const { prisma, markSold, deps } = createFake({
      remoteStatus: "SOLD",
      sellerId: "owner-1",
    });

    await syncStockXListingStatus(prisma, {
      userId: "member-1",
      accountId: "account-1",
      marketplaceListingId: "listing-row-1",
    }, deps);

    expect(markSold).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: "member-1",
        accountId: "account-1",
        inventoryOwnerUserId: "owner-1",
        inventoryItemId: "item-1",
      }),
    );
  });

  it("does not pre-mark the source listing sold when the atomic sold transition fails", async () => {
    const { prisma, listing, events, markSold, deps } = createFake({
      remoteStatus: "SOLD",
    });
    markSold.mockRejectedValueOnce(new Error("transaction failed"));

    await expect(
      syncStockXListingStatus(
        prisma,
        {
          userId: "user-1",
          accountId: "account-1",
          marketplaceListingId: "listing-row-1",
        },
        deps,
      ),
    ).rejects.toThrow("transaction failed");

    expect(listing.status).toBe("LISTING");
    expect(events).toHaveLength(0);
  });

  it("uses account scope for teammate status sync and rejects a foreign account", async () => {
    const { prisma, markSold, fetchListingStatus, deps } = createFake({
      remoteStatus: "SOLD",
      sellerId: "owner-1",
    });

    await expect(
      syncStockXListingStatus(
        prisma,
        {
          userId: "member-1",
          accountId: "foreign-account",
          marketplaceListingId: "listing-row-1",
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(fetchListingStatus).not.toHaveBeenCalled();
    expect(markSold).not.toHaveBeenCalled();
  });

  it("marks removed StockX listings ended without marking the item sold", async () => {
    const { prisma, listing, events, markSold, deps } = createFake({
      remoteStatus: "DEACTIVATED",
    });

    const result = await syncStockXListingStatus(prisma, {
      userId: "user-1",
      marketplaceListingId: "listing-row-1",
    }, deps);

    expect(result.status).toBe("ended");
    expect(listing.status).toBe("ENDED");
    expect(listing.endedAt).toBeInstanceOf(Date);
    expect(events.map((event) => event.kind)).toContain("stockx_listing_ended");
    expect(markSold).not.toHaveBeenCalled();
  });

  it("keeps unknown provider statuses non-terminal", async () => {
    const { prisma, listing, events, attempts, markSold, deps } = createFake({
      remoteStatus: "PENDING_REVIEW",
    });

    const result = await syncStockXListingStatus(prisma, {
      userId: "user-1",
      marketplaceListingId: "listing-row-1",
    }, deps);

    expect(result.status).toBe("unknown");
    expect(listing.status).toBe("LISTING");
    expect(listing.lastSyncAt).toBeInstanceOf(Date);
    expect(events).toHaveLength(0);
    expect(attempts[0].status).toBe("RUNNING");
    expect(markSold).not.toHaveBeenCalled();
  });

  it("does not infer sold or active from a completed async operation", async () => {
    const { prisma, listing, events, attempts, markSold, deps } = createFake({
      remoteStatus: "PENDING_REVIEW",
      operationStatus: "COMPLETED",
    });

    const result = await syncStockXListingStatus(
      prisma,
      {
        userId: "user-1",
        marketplaceListingId: "listing-row-1",
      },
      deps,
    );

    expect(result.status).toBe("unknown");
    expect(listing.status).toBe("LISTING");
    expect(attempts[0].status).toBe("RUNNING");
    expect(events).toHaveLength(0);
    expect(markSold).not.toHaveBeenCalled();
  });

  it("keeps an explicitly active listing active when its operation is completed", async () => {
    const { prisma, listing, markSold, deps } = createFake({
      remoteStatus: "ACTIVE",
      operationStatus: "COMPLETED",
    });

    const result = await syncStockXListingStatus(
      prisma,
      {
        userId: "user-1",
        marketplaceListingId: "listing-row-1",
      },
      deps,
    );

    expect(result.status).toBe("active");
    expect(listing.status).toBe("LISTED");
    expect(markSold).not.toHaveBeenCalled();
  });
});
