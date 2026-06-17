import { describe, expect, it, vi } from "vitest";

import {
  cleanupEbayOrphanArtifacts,
  scanEbayOrphanArtifacts,
  type EbayOrphanPrismaLike,
} from "./orphans";

function createFakePrisma() {
  const state = {
    attempts: [] as Array<{
      id: string;
      status: string;
      code: string;
      reason: string | null;
      adapterResult?: unknown;
    }>,
    events: [] as Array<{ kind: string; data: unknown }>,
    listing: {
      id: "ml-1",
      status: "NOT_LISTED",
      sku: null as string | null,
      externalOfferId: null as string | null,
      externalListingId: null as string | null,
      publishAttempts: [] as Array<{ status: string; code: string }>,
    },
    updates: [] as Array<Record<string, unknown>>,
    inventoryUpdates: [] as Array<Record<string, unknown>>,
  };

  const prisma = {
    _state: state,
    inventoryItem: {
      async findFirst() {
        return {
          id: "item-1",
          sellerId: "user-1",
          brand: "Nike",
          condition: "used_good",
          size: "10",
          colorway: "Brown",
          listingDrafts: [{ title: "Reverse Mocha" }],
        };
      },
      async update({ data }: { data: Record<string, unknown> }) {
        state.inventoryUpdates.push(data);
        return { id: "item-1" };
      },
    },
    marketplaceConnection: {
      async findUnique() {
        return {
          id: "conn-1",
          userId: "user-1",
          accessTokenEnc: "enc",
          refreshTokenEnc: "enc",
          accessTokenExpiresAt: new Date(Date.now() + 100_000),
          refreshTokenExpiresAt: null,
          scopes: [],
        };
      },
      async update() {
        return {};
      },
    },
    marketplaceListing: {
      async findFirst() {
        return state.listing;
      },
      async upsert() {
        return state.listing;
      },
      async update({ data }: { data: Record<string, unknown> }) {
        state.updates.push(data);
        if (typeof data.status === "string") state.listing.status = data.status;
        return { id: state.listing.id };
      },
      async findMany() {
        return [{ status: state.listing.status }];
      },
    },
    publishAttempt: {
      async create({ data }: { data: typeof state.attempts[number] }) {
        const id = `attempt-${state.attempts.length + 1}`;
        state.attempts.push({ ...data, id });
        return { id };
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<(typeof state.attempts)[number]>;
      }) {
        const attempt = state.attempts.find((entry) => entry.id === where.id);
        if (!attempt) throw new Error("attempt not found");
        Object.assign(attempt, data);
        return { id: where.id };
      },
    },
    marketplaceEvent: {
      async create({ data }: { data: { kind: string; data: unknown } }) {
        state.events.push({ kind: data.kind, data: data.data });
        return { id: `event-${state.events.length}` };
      },
    },
  };

  return prisma as unknown as EbayOrphanPrismaLike & { _state: typeof state };
}

const testEnv = {
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  EBAY_REDIRECT_URI_NAME: "redirect-name",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_TOKEN_ENCRYPTION_KEY: "12345678901234567890123456789012",
};

describe("eBay orphan publish artifact recovery", () => {
  it("detects orphan inventory and unpublished offers by SKU", async () => {
    const prisma = createFakePrisma();
    const client = {
      getInventoryItem: vi.fn().mockResolvedValue({ sku: "percsitem1" }),
      getOffersBySku: vi
        .fn()
        .mockResolvedValue([{ offerId: "offer-1", status: "UNPUBLISHED" }]),
      deleteOffer: vi.fn(),
      deleteInventoryItem: vi.fn(),
    };

    const scan = await scanEbayOrphanArtifacts(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
    }, {
      env: testEnv,
      resolveAccessToken: vi.fn().mockResolvedValue("token"),
      createClient: vi.fn().mockReturnValue(client),
    });

    expect(scan).toMatchObject({
      sku: "percsitem1",
      inventoryItemFound: true,
      cleanupAvailable: true,
      liveListingFound: false,
    });
    expect(scan.offers[0].offerId).toBe("offer-1");
    expect(client.getInventoryItem).toHaveBeenCalledWith("percsitem1");
    expect(client.getOffersBySku).toHaveBeenCalledWith("percsitem1");
  });

  it("requires confirmation before cleanup", async () => {
    const prisma = createFakePrisma();

    await expect(
      cleanupEbayOrphanArtifacts(prisma, {
        userId: "user-1",
        inventoryItemId: "item-1",
        confirmCleanup: false,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("cleans unpublished artifacts and logs the cleanup attempt", async () => {
    const prisma = createFakePrisma();
    const client = {
      getInventoryItem: vi.fn().mockResolvedValue({ sku: "percsitem1" }),
      getOffersBySku: vi
        .fn()
        .mockResolvedValue([{ offerId: "offer-1", status: "UNPUBLISHED" }]),
      deleteOffer: vi.fn().mockResolvedValue(undefined),
      deleteInventoryItem: vi.fn().mockResolvedValue(undefined),
    };

    const result = await cleanupEbayOrphanArtifacts(
      prisma,
      {
        userId: "user-1",
        inventoryItemId: "item-1",
        confirmCleanup: true,
      },
      {
        env: testEnv,
        resolveAccessToken: vi.fn().mockResolvedValue("token"),
        createClient: vi.fn().mockReturnValue(client),
      },
    );

    expect(result.status).toBe("cleaned");
    expect(client.deleteOffer).toHaveBeenCalledWith("offer-1");
    expect(client.deleteInventoryItem).toHaveBeenCalledWith("percsitem1");
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "SUCCEEDED",
      code: "EBAY_ORPHAN_CLEANUP_SUCCEEDED",
    });
    expect(prisma._state.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "ebay_orphan_cleanup_started",
        "ebay_orphan_cleanup_succeeded",
      ]),
    );
    expect(prisma._state.inventoryUpdates).toEqual([]);
  });

  it("syncs master status after cleanup when the channel is already delisted", async () => {
    const prisma = createFakePrisma();
    prisma._state.listing.status = "DELISTED";
    const client = {
      getInventoryItem: vi.fn().mockResolvedValue({ sku: "percsitem1" }),
      getOffersBySku: vi
        .fn()
        .mockResolvedValue([{ offerId: "offer-1", status: "UNPUBLISHED" }]),
      deleteOffer: vi.fn().mockResolvedValue(undefined),
      deleteInventoryItem: vi.fn().mockResolvedValue(undefined),
    };

    await cleanupEbayOrphanArtifacts(
      prisma,
      {
        userId: "user-1",
        inventoryItemId: "item-1",
        confirmCleanup: true,
      },
      {
        env: testEnv,
        resolveAccessToken: vi.fn().mockResolvedValue("token"),
        createClient: vi.fn().mockReturnValue(client),
      },
    );

    expect(prisma._state.inventoryUpdates).toEqual([{ status: "DELISTED" }]);
  });

  it("allows cleanup for ended listing artifacts", async () => {
    const prisma = createFakePrisma();
    const client = {
      getInventoryItem: vi.fn().mockResolvedValue({ sku: "percsitem1" }),
      getOffersBySku: vi.fn().mockResolvedValue([
        {
          offerId: "offer-1",
          status: "UNPUBLISHED",
          listing: { listingId: "listing-1", listingStatus: "ENDED" },
        },
      ]),
      deleteOffer: vi.fn().mockResolvedValue(undefined),
      deleteInventoryItem: vi.fn().mockResolvedValue(undefined),
    };

    const result = await cleanupEbayOrphanArtifacts(
      prisma,
      {
        userId: "user-1",
        inventoryItemId: "item-1",
        confirmCleanup: true,
      },
      {
        env: testEnv,
        resolveAccessToken: vi.fn().mockResolvedValue("token"),
        createClient: vi.fn().mockReturnValue(client),
      },
    );

    expect(result.status).toBe("cleaned");
    expect(client.deleteOffer).toHaveBeenCalledWith("offer-1");
    expect(client.deleteInventoryItem).toHaveBeenCalledWith("percsitem1");
  });

  it("refuses cleanup when a live listing is detected", async () => {
    const prisma = createFakePrisma();
    const client = {
      getInventoryItem: vi.fn().mockResolvedValue({ sku: "percsitem1" }),
      getOffersBySku: vi.fn().mockResolvedValue([
        {
          offerId: "offer-1",
          status: "PUBLISHED",
          listing: { listingId: "listing-1", listingStatus: "ACTIVE" },
        },
      ]),
      deleteOffer: vi.fn(),
      deleteInventoryItem: vi.fn(),
    };

    await expect(
      cleanupEbayOrphanArtifacts(
        prisma,
        {
          userId: "user-1",
          inventoryItemId: "item-1",
          confirmCleanup: true,
        },
        {
          env: testEnv,
          resolveAccessToken: vi.fn().mockResolvedValue("token"),
          createClient: vi.fn().mockReturnValue(client),
        },
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(client.deleteOffer).not.toHaveBeenCalled();
    expect(client.deleteInventoryItem).not.toHaveBeenCalled();
  });
});
