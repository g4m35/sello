import { describe, expect, it, vi } from "vitest";

import type { InventoryStatus } from "@/generated/prisma/client";

import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { stockxErrorCodes } from "./adapters/stockx/errors";
import {
  executePublish,
  publishingMigrationMissingCode,
  type PublishPrismaLike,
} from "./publish-handler";

type FakeState = {
  listings: Map<
    string,
    {
      id: string;
      inventoryItemId: string;
      marketplace: string;
      environment: string;
    }
  >;
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
        const key = `${where.inventoryItemId_marketplace_environment.inventoryItemId}|${where.inventoryItemId_marketplace_environment.marketplace}|${where.inventoryItemId_marketplace_environment.environment}`;
        if (!state.listings.has(key)) {
          const id = `listing-${state.listings.size + 1}`;
          state.listings.set(key, {
            id,
            inventoryItemId: create.inventoryItemId,
            marketplace: create.marketplace,
            environment: "sandbox",
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

  it("publishes a complete draft without requiring an approved/ready status", async () => {
    const prisma = createFakePrisma({ itemStatus: "DRAFT_READY" });

    // No "mark ready" step: a DRAFT_READY item proceeds straight to the publish
    // flow (readiness is enforced by the adapter, not a status gate).
    const result = await executePublish(prisma, {
      userId: "user-1",
      inventoryItemId: "item-1",
      marketplace: "ebay",
    });

    expect(result.ok).toBe(true);
    expect(prisma._state.listings.size).toBe(1);
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
  environment: string;
  status: string;
  externalListingId: string | null;
  externalOfferId: string | null;
  sku: string | null;
  publishAttempts?: Array<{ status: string; code?: string }>;
};

type EbayFakeState = {
  attempts: Array<{
    id: string;
    status: string;
    code: string;
    reason: string | null;
    idempotencyKey?: string | null;
    adapterResult?: unknown;
  }>;
  events: Array<{ kind: string; data: Record<string, unknown> }>;
  updates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  inventoryUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  listings: Map<string, EbayFakeListing>;
  syncJobs: Array<{
    id: string;
    type: string;
    idempotencyKey: string;
    payload: unknown;
    runAfter: Date;
  }>;
};

function createEbayFakePrisma(opts?: {
  existingListing?: Partial<EbayFakeListing>;
  environment?: string;
  rejectActiveAttempt?: boolean;
}) {
  const environment = opts?.environment ?? "sandbox";
  const state: EbayFakeState = {
    attempts: [],
    events: [],
    updates: [],
    inventoryUpdates: [],
    listings: new Map(),
    syncJobs: [],
  };

  const prisma = {
    _state: state,
    inventoryItem: {
      async findFirst({ where }: { where: { id: string; sellerId: string } }) {
        if (where.id !== "item-1" || where.sellerId !== "user-1") return null;
        return { id: "item-1", status: "APPROVED" as InventoryStatus };
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        state.inventoryUpdates.push({ where, data });
        return { id: where.id };
      },
    },
    marketplaceListing: {
      async findFirst({
        where,
      }: {
        where: {
          inventoryItemId: string;
          marketplace: string;
          environment: string;
        };
      }) {
        const k = `${where.inventoryItemId}|${where.marketplace}|${where.environment}`;
        return state.listings.get(k) ?? null;
      },
      async create({
        data,
      }: {
        data: { inventoryItemId: string; marketplace: string; environment: string };
      }) {
        const k = `${data.inventoryItemId}|${data.marketplace}|${data.environment}`;
        const listing = {
          id: opts?.existingListing?.id ?? `listing-${state.listings.size + 1}`,
          environment: data.environment,
          status: opts?.existingListing?.status ?? "NOT_LISTED",
          externalListingId: opts?.existingListing?.externalListingId ?? null,
          externalOfferId: opts?.existingListing?.externalOfferId ?? null,
          sku: opts?.existingListing?.sku ?? null,
          publishAttempts: opts?.existingListing?.publishAttempts ?? [],
        };
        state.listings.set(k, listing);
        return listing;
      },
      async upsert({
        where,
      }: {
        where: {
          inventoryItemId_marketplace_environment: {
            inventoryItemId: string;
            marketplace: string;
            environment: string;
          };
        };
        create: { inventoryItemId: string; marketplace: string; environment: string };
      }) {
        const k = `${where.inventoryItemId_marketplace_environment.inventoryItemId}|${where.inventoryItemId_marketplace_environment.marketplace}|${where.inventoryItemId_marketplace_environment.environment}`;
        if (!state.listings.has(k)) {
          state.listings.set(k, {
            id: opts?.existingListing?.id ?? `listing-${state.listings.size + 1}`,
            environment,
            status: opts?.existingListing?.status ?? "NOT_LISTED",
            externalListingId: opts?.existingListing?.externalListingId ?? null,
            externalOfferId: opts?.existingListing?.externalOfferId ?? null,
            sku: opts?.existingListing?.sku ?? null,
            publishAttempts: opts?.existingListing?.publishAttempts ?? [],
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
        data: {
          status: string;
          code: string;
          reason: string | null;
          idempotencyKey?: string | null;
        };
      }) {
        // Simulate the partial unique index rejecting a duplicate active attempt.
        if (opts?.rejectActiveAttempt && data.status === "RUNNING") {
          throw Object.assign(
            new Error(
              "Unique constraint failed on the fields: (`marketplaceListingId`,`idempotencyKey`)",
            ),
            { code: "P2002" },
          );
        }
        const id = `attempt-${state.attempts.length + 1}`;
        state.attempts.push({
          id,
          status: data.status,
          code: data.code,
          reason: data.reason ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          adapterResult: "adapterResult" in data ? data.adapterResult : null,
        });
        return { id };
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          status?: string;
          code?: string;
          reason?: string | null;
          adapterResult?: unknown;
        };
      }) {
        const attempt = state.attempts.find((a) => a.id === where.id);
        if (!attempt) throw new Error("attempt not found");
        if (data.status) attempt.status = data.status;
        if (data.code) attempt.code = data.code;
        if ("reason" in data) attempt.reason = data.reason ?? null;
        if ("adapterResult" in data) attempt.adapterResult = data.adapterResult;
        return { id: where.id };
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
    syncJob: {
      async upsert({
        where,
        create,
      }: {
        where: { idempotencyKey: string };
        create: {
          type: string;
          idempotencyKey: string;
          payload: unknown;
          runAfter: Date;
        };
      }) {
        const existing = state.syncJobs.find(
          (job) => job.idempotencyKey === where.idempotencyKey,
        );
        if (existing) return { id: existing.id };
        const job = {
          id: `sync-${state.syncJobs.length + 1}`,
          type: create.type,
          idempotencyKey: create.idempotencyKey,
          payload: create.payload,
          runAfter: create.runAfter,
        };
        state.syncJobs.push(job);
        return { id: job.id };
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

  it("preserves bulk correlation when a publish is not enabled", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockResolvedValue({
      status: "not_enabled",
      code: ebayErrorCodes.publishNotEnabled,
      marketplace: "ebay",
      environment: "sandbox",
      message: "disabled",
    });

    await executePublish(
      prisma,
      { ...input, bulkRunId: "bulk-run-1" },
      undefined,
      ebayPublish,
    );

    expect(prisma._state.attempts[0].adapterResult).toMatchObject({
      bulkRunId: "bulk-run-1",
      code: ebayErrorCodes.publishNotEnabled,
    });
    expect(
      prisma._state.events.find((event) => event.kind === "publish_blocked")?.data,
    ).toMatchObject({ bulkRunId: "bulk-run-1" });
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
      steps: [
        { step: "inventory_item", status: "started" },
        { step: "inventory_item", status: "succeeded" },
        { step: "offer", status: "started" },
        { step: "offer", status: "succeeded" },
        { step: "publish", status: "started" },
        { step: "publish", status: "succeeded" },
      ],
    });

    const result = await executePublish(prisma, input, undefined, ebayPublish);

    expect(result.outcome.status).toBe("published");
    expect(result.sku).toBe("percs_item-1");
    expect(result.offerId).toBe("offer-1");
    expect(result.listingId).toBe("listing-x");

    expect(prisma._state.attempts[0].idempotencyKey).toBe("item-1:ebay:sandbox");
    expect(prisma._state.attempts[0].status).toBe("SUCCEEDED");
    const update = prisma._state.updates[0];
    expect(update.data.sku).toBe("percs_item-1");
    expect(update.data.externalOfferId).toBe("offer-1");
    expect(update.data.externalListingId).toBe("listing-x");
    expect(update.data.status).toBe("LISTED");
    expect(prisma._state.inventoryUpdates).toEqual([
      { where: { id: "item-1" }, data: { status: "LISTED" } },
    ]);
    expect(prisma._state.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        "ebay_inventory_item_created",
        "ebay_offer_created",
        "ebay_offer_published",
        "ebay_publish_step_started",
        "ebay_publish_step_succeeded",
      ]),
    );
  });

  it("preserves bulk correlation on successful attempt updates and events", async () => {
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

    await executePublish(
      prisma,
      { ...input, bulkRunId: "bulk-run-1" },
      undefined,
      ebayPublish,
    );

    expect(prisma._state.attempts[0].adapterResult).toMatchObject({
      bulkRunId: "bulk-run-1",
      code: "EBAY_PUBLISH_SUCCEEDED",
    });
    expect(prisma._state.events).not.toHaveLength(0);
    expect(prisma._state.events.every((event) => event.data.bulkRunId === "bulk-run-1"))
      .toBe(true);
  });

  it("creates the eBay PublishAttempt before outbound publishing runs", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockImplementation(async () => {
      expect(prisma._state.attempts[0]).toMatchObject({
        status: "RUNNING",
        code: "EBAY_PUBLISH_STARTED",
        idempotencyKey: "item-1:ebay:sandbox",
      });
      return {
        status: "published",
        code: "EBAY_PUBLISH_SUCCEEDED",
        marketplace: "ebay",
        environment: "sandbox",
        sku: "percs_item-1",
        offerId: "offer-1",
        listingId: "listing-x",
      };
    });

    await executePublish(prisma, input, undefined, ebayPublish);

    expect(ebayPublish).toHaveBeenCalledOnce();
    expect(prisma._state.events[0].kind).toBe("publish_started");
  });

  it("stores bulk correlation on the initial attempt and started event", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockImplementation(async () => {
      expect(prisma._state.attempts[0].adapterResult).toEqual({
        bulkRunId: "bulk-run-1",
      });
      expect(prisma._state.events[0].data).toMatchObject({
        bulkRunId: "bulk-run-1",
      });
      return {
        status: "not_enabled",
        code: ebayErrorCodes.publishNotEnabled,
        marketplace: "ebay",
        environment: "sandbox",
        message: "disabled",
      };
    });

    await executePublish(
      prisma,
      { ...input, bulkRunId: "bulk-run-1" },
      undefined,
      ebayPublish,
    );
  });

  it("blocks duplicate eBay publish when a listing ID already exists", async () => {
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        status: "LISTED",
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
        status: "NOT_LISTED",
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

  it("blocks duplicate eBay publish when a pending attempt exists", async () => {
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        externalListingId: null,
        externalOfferId: null,
        sku: null,
        publishAttempts: [{ status: "RUNNING", code: "EBAY_PUBLISH_STARTED" }],
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

  it("blocks duplicate eBay publish when a succeeded attempt exists", async () => {
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        externalListingId: null,
        externalOfferId: null,
        sku: null,
        publishAttempts: [{ status: "SUCCEEDED", code: "EBAY_PUBLISH_SUCCEEDED" }],
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

  it("does NOT block publish when only a succeeded orphan-cleanup attempt exists", async () => {
    // Orphan cleanup records a PublishAttempt with status SUCCEEDED but code
    // EBAY_ORPHAN_CLEANUP_SUCCEEDED. That must not be mistaken for a live listing,
    // otherwise an item can never be (re)published after its orphans are cleaned.
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        externalListingId: null,
        externalOfferId: null,
        sku: null,
        publishAttempts: [
          { status: "SUCCEEDED", code: "EBAY_ORPHAN_CLEANUP_SUCCEEDED" },
          { status: "FAILED", code: "EBAY_PUBLISH_FAILED" },
        ],
      },
    });
    const ebayPublish = vi.fn().mockResolvedValue({
      status: "not_enabled",
      code: ebayErrorCodes.publishNotEnabled,
      marketplace: "ebay",
      environment: "sandbox",
      message: "disabled",
    });

    const result = await executePublish(prisma, input, undefined, ebayPublish);

    expect(ebayPublish).toHaveBeenCalledTimes(1);
    expect(result.outcome.code).toBe(ebayErrorCodes.publishNotEnabled);
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

  it("maps a DB unique-constraint violation on the active attempt to a 409 already-published error", async () => {
    // The partial unique index on PublishAttempt(marketplaceListingId, idempotencyKey)
    // is the real concurrency guard: when two publishes race past the in-memory
    // check, the DB rejects the second active attempt. That loser must surface as
    // the typed already-published 409, not a raw P2002, and must NOT publish.
    const prisma = createEbayFakePrisma({ rejectActiveAttempt: true });
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
    expect(prisma._state.attempts[0].reason).toContain("Missing: title.");
    expect(prisma._state.events.some((e) => e.kind === "publish_failed")).toBe(true);
    expect(
      prisma._state.events.find((e) => e.kind === "publish_failed")?.data.missing,
    ).toEqual(["title"]);
    expect(prisma._state.updates).toHaveLength(0);
  });

  it("sanitizes the persisted failure reason and ebayError (no raw provider/token text)", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockRejectedValue(
      new EbayIntegrationError(
        ebayErrorCodes.apiFailed,
        'eBay API request failed: {"errors":[{"errorId":25001,"message":"x"}]}',
        502,
        {
          step: "publish",
          ebayError: {
            status: 500,
            message: "Authorization: Bearer leaked.secret.token refresh_token=abc",
          },
        },
      ),
    );

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({ code: ebayErrorCodes.apiFailed });

    const attempt = prisma._state.attempts[0];
    expect(attempt.status).toBe("FAILED");
    // reason scrubbed to the safe per-route fallback (raw eBay JSON dropped).
    expect(attempt.reason).toBe("eBay publish failed.");
    // persisted ebayError keeps the numeric status but scrubs the message.
    const adapterResult = attempt.adapterResult as {
      ebayError?: { status?: number; message?: string };
    };
    expect(adapterResult.ebayError?.status).toBe(500);
    expect(adapterResult.ebayError?.message).toBe("eBay returned an error.");

    // Nothing dangerous anywhere in the persisted attempt + events.
    const serialized = JSON.stringify({
      attempts: prisma._state.attempts,
      events: prisma._state.events,
    });
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("leaked.secret");
    expect(serialized).not.toMatch(/\{"errors"/);
  });

  it("preserves bulk correlation on failed attempt updates and events", async () => {
    const prisma = createEbayFakePrisma();
    const ebayPublish = vi.fn().mockRejectedValue(
      new EbayIntegrationError(
        ebayErrorCodes.readinessFailed,
        "not ready",
        422,
        { missing: ["title"] },
      ),
    );

    await expect(
      executePublish(
        prisma,
        { ...input, bulkRunId: "bulk-run-1" },
        undefined,
        ebayPublish,
      ),
    ).rejects.toMatchObject({ code: ebayErrorCodes.readinessFailed });

    expect(prisma._state.attempts[0].adapterResult).toMatchObject({
      bulkRunId: "bulk-run-1",
      code: ebayErrorCodes.readinessFailed,
    });
    const failureEvents = prisma._state.events.filter(
      (event) => event.kind === "publish_failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0].kind).toBe("publish_failed");
    expect(failureEvents[0].data.bulkRunId).toBe("bulk-run-1");
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
          {
            step: "offer",
            stepEvents: [
              { step: "inventory_item", status: "started" },
              { step: "inventory_item", status: "succeeded" },
              { step: "offer", status: "started" },
              { step: "offer", status: "failed" },
            ],
            startedSteps: ["inventory_item", "offer"],
            succeededSteps: ["inventory_item"],
            ebayError: {
              status: 400,
              message: "Fulfillment policy was not found.",
              errors: [
                {
                  errorId: "25001",
                  message: "Fulfillment policy was not found.",
                  parameters: [{ name: "access_token", value: "[redacted]" }],
                },
              ],
            },
          },
        ),
      );

    await expect(
      executePublish(prisma, input, undefined, ebayPublish),
    ).rejects.toMatchObject({ code: ebayErrorCodes.publishFailed });

    const failed = prisma._state.events.find((e) => e.kind === "publish_failed");
    expect(failed?.data.step).toBe("offer");
    expect(failed?.data.ebayError).toMatchObject({
      status: 400,
      message: "Fulfillment policy was not found.",
    });
    expect(JSON.stringify(prisma._state.attempts[0].adapterResult)).not.toContain(
      "secret-access-token",
    );
    expect(prisma._state.attempts[0].adapterResult).toMatchObject({
      step: "offer",
      startedSteps: ["inventory_item", "offer"],
      succeededSteps: ["inventory_item"],
      ebayError: {
        status: 400,
        message: "Fulfillment policy was not found.",
      },
    });
    expect(prisma._state.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        "ebay_publish_step_started",
        "ebay_publish_step_succeeded",
        "ebay_publish_step_failed",
      ]),
    );
  });
});

describe("executePublish — StockX dispatch", () => {
  const input = {
    userId: "user-1",
    inventoryItemId: "item-1",
    marketplace: "stockx" as const,
    confirmLivePublish: true,
  };

  it("creates a running StockX attempt, submits the listing, and stores the StockX listing id", async () => {
    const prisma = createEbayFakePrisma();
    const stockxPublish = vi.fn().mockResolvedValue({
      status: "submitted",
      code: stockxErrorCodes.listingSubmitted,
      marketplace: "stockx",
      environment: "production",
      listingId: "stockx-listing-1",
      operationId: "operation-1",
      operationStatus: "PENDING",
      operationUrl:
        "https://api.stockx.com/v2/selling/listings/stockx-listing-1/operations/operation-1",
    });

    const result = await executePublish(
      prisma,
      input,
      undefined,
      undefined,
      stockxPublish,
    );

    expect(result.httpStatus).toBe(202);
    expect(result.outcome.status).toBe("submitted");
    expect(result.listingId).toBe("stockx-listing-1");
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "RUNNING",
      code: stockxErrorCodes.listingSubmitted,
      idempotencyKey: "item-1:stockx:production",
    });
    expect(prisma._state.updates[0].data).toMatchObject({
      status: "LISTING",
      externalListingId: "stockx-listing-1",
    });
    expect(prisma._state.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["publish_started", "stockx_listing_submitted"]),
    );
    expect(prisma._state.syncJobs).toHaveLength(1);
    expect(prisma._state.syncJobs[0]).toMatchObject({
      type: "detect_status",
      idempotencyKey:
        "item-1:stockx:production:detect_status:operation-1",
    });
    expect(prisma._state.syncJobs[0].payload).toMatchObject({
      marketplace: "stockx",
      listingId: "stockx-listing-1",
      operationId: "operation-1",
      operationStatus: "PENDING",
    });
  });

  it("records StockX listing disabled without making the listing live", async () => {
    const prisma = createEbayFakePrisma();
    const stockxPublish = vi.fn().mockResolvedValue({
      status: "not_enabled",
      code: stockxErrorCodes.listingNotEnabled,
      marketplace: "stockx",
      environment: "production",
      message: "StockX listing creation is disabled.",
    });

    const result = await executePublish(
      prisma,
      input,
      undefined,
      undefined,
      stockxPublish,
    );

    expect(result.httpStatus).toBe(503);
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "NOT_IMPLEMENTED",
      code: stockxErrorCodes.listingNotEnabled,
    });
    expect(prisma._state.updates).toHaveLength(0);
  });

  it("blocks duplicate StockX publish when a listing id already exists", async () => {
    const prisma = createEbayFakePrisma({
      existingListing: {
        id: "listing-1",
        status: "LISTING",
        externalListingId: "stockx-listing-1",
        externalOfferId: null,
        sku: null,
      },
    });
    const stockxPublish = vi.fn();

    await expect(
      executePublish(prisma, input, undefined, undefined, stockxPublish),
    ).rejects.toMatchObject({
      code: stockxErrorCodes.alreadyPublished,
      status: 409,
    });

    expect(stockxPublish).not.toHaveBeenCalled();
  });
});
