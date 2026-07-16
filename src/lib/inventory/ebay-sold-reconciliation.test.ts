import { describe, expect, it } from "vitest";

import {
  createInventoryFakePrisma,
  type FakeItem,
  type FakeListing,
} from "./test-fake-prisma";
import type { MarkSoldTransaction } from "./mark-sold";
import {
  classifyEbaySoldSignal,
  reconcileEbaySoldSignal,
  type EbaySoldReconciliationPrismaLike,
  type EbaySoldSignal,
} from "./ebay-sold-reconciliation";

function item(overrides: Partial<FakeItem> = {}): FakeItem {
  return {
    id: "item-1",
    sellerId: "owner-1",
    accountId: "account-1",
    productName: "Nike Dunk Low Panda",
    status: "LISTED",
    soldAt: null,
    quantityAvailable: 1,
    soldSourceMarketplace: null,
    soldSourceListingId: null,
    lockVersion: 0,
    ...overrides,
  };
}

function listing(overrides: Partial<FakeListing> = {}): FakeListing {
  return {
    id: "listing-ebay",
    inventoryItemId: "item-1",
    marketplace: "ebay",
    status: "LISTED",
    externalListingId: "ebay-listing-1",
    externalUrl: "https://www.ebay.com/itm/1",
    titleSnapshot: "Nike Dunk Low Panda",
    ...overrides,
  };
}

const baseSignal: EbaySoldSignal = {
  accountId: "account-1",
  actorUserId: "worker-user",
  environment: "production",
  externalEventId: "order-1:line-1:v1",
  externalOrderId: "order-1",
  externalLineItemId: "line-1",
  externalListingId: "ebay-listing-1",
  paymentStatus: "PAID",
  fulfillmentStatus: "NOT_STARTED",
  cancelState: "NONE_REQUESTED",
  quantity: 1,
  soldPriceCents: 12500,
  verifiedSource: true,
};

type SignalCreateData = {
  accountId: string;
  marketplace: "ebay";
  environment: string;
  externalEventId: string;
  externalOrderId: string;
  externalLineItemId: string;
  externalListingId: string;
  state: string;
  processingStartedAt: Date;
  processingOwner: string;
  processingAttempts: number;
};
type SignalUniqueWhere = {
  accountId_marketplace_environment_externalEventId: {
    accountId: string;
    marketplace: "ebay";
    environment: string;
    externalEventId: string;
  };
};
type SignalUpdateData = {
  state?: string;
  outcome?: string;
  inventoryItemId?: string | null;
  processedAt?: Date;
  processingStartedAt?: Date | null;
  processingOwner?: string | null;
  processingAttempts?: { increment: number };
};

function reconciliationDb(opts: {
  items?: FakeItem[];
  listings?: FakeListing[];
  failListingLookupOnce?: boolean;
} = {}) {
  const prisma = createInventoryFakePrisma({
    items: opts.items ?? [item()],
    listings: opts.listings ?? [
      listing(),
      listing({
        id: "listing-grailed",
        marketplace: "grailed",
        externalListingId: "grailed-1",
        externalUrl: "https://grailed.com/listings/1",
      }),
    ],
  });
  const rows: Array<{
    id: string;
    accountId: string;
    marketplace: "ebay";
    environment: string;
    externalEventId: string;
    externalOrderId: string;
    externalLineItemId: string;
    externalListingId: string;
    state: string;
    outcome: string | null;
    inventoryItemId: string | null;
    processedAt: Date | null;
    processingStartedAt: Date | null;
    processingOwner: string | null;
    processingAttempts: number;
  }> = [];
  const marketplaceSaleSignal = {
    async create({ data }: { data: SignalCreateData }) {
      if (rows.some((row) =>
        row.accountId === data.accountId &&
        row.marketplace === data.marketplace &&
        row.environment === data.environment &&
        row.externalEventId === data.externalEventId
      )) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const row = {
        id: `signal-${rows.length + 1}`,
        accountId: data.accountId,
        marketplace: "ebay" as const,
        environment: data.environment,
        externalEventId: data.externalEventId,
        externalOrderId: data.externalOrderId,
        externalLineItemId: data.externalLineItemId,
        externalListingId: data.externalListingId,
        state: data.state,
        outcome: null,
        inventoryItemId: null,
        processedAt: null,
        processingStartedAt: data.processingStartedAt,
        processingOwner: data.processingOwner,
        processingAttempts: data.processingAttempts,
      };
      rows.push(row);
      return { id: row.id };
    },
    async findUnique({ where }: { where: SignalUniqueWhere }) {
      const key = where.accountId_marketplace_environment_externalEventId;
      return rows.find((row) =>
        row.accountId === key.accountId &&
        row.marketplace === key.marketplace &&
        row.environment === key.environment &&
        row.externalEventId === key.externalEventId
      ) ?? null;
    },
    async updateMany({
      where,
      data,
    }: {
      where: {
        id: string;
        processedAt: null;
        processingOwner?: string;
        OR?: Array<{ processingStartedAt: null } | { processingStartedAt: { lte: Date } }>;
      };
      data: SignalUpdateData;
    }) {
      const row = rows.find((entry) => entry.id === where.id);
      if (!row || row.processedAt !== null) return { count: 0 };
      if (where.processingOwner && row.processingOwner !== where.processingOwner) {
        return { count: 0 };
      }
      if (where.OR) {
        const eligible = where.OR.some((condition) =>
          condition.processingStartedAt === null
            ? row.processingStartedAt === null
            : row.processingStartedAt !== null &&
              row.processingStartedAt <= condition.processingStartedAt.lte
        );
        if (!eligible) return { count: 0 };
      }
      const attempts = data.processingAttempts?.increment ?? 0;
      Object.assign(row, { ...data, processingAttempts: row.processingAttempts + attempts });
      return { count: 1 };
    },
  };
  const transactionDb: MarkSoldTransaction = {
    inventoryItem: {
      findFirst: async ({ where }) => {
        const found = prisma._store.items.find((candidate) =>
          candidate.id === where.id &&
          (where.accountId === undefined || candidate.accountId === where.accountId) &&
          (where.sellerId === undefined || candidate.sellerId === where.sellerId)
        );
        return found
          ? {
              id: found.id,
              accountId: found.accountId ?? `account-${found.sellerId}`,
              productName: found.productName,
            }
          : null;
      },
      update: async ({ where, data }) => {
        const found = prisma._store.items.find((candidate) => candidate.id === where.id);
        if (!found || found.lockVersion !== where.lockVersion) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        found.status = data.status;
        found.quantityAvailable = data.quantityAvailable;
        found.soldAt = data.soldAt;
        found.soldSourceMarketplace = data.soldSourceMarketplace;
        found.soldSourceListingId = data.soldSourceListingId;
        found.lockVersion += data.lockVersion.increment;
        return { id: found.id };
      },
    },
    marketplaceListing: {
      findMany: (args) => prisma.marketplaceListing.findMany(args),
      update: async ({ where, data }) => {
        const found = prisma._store.listings.find((candidate) => candidate.id === where.id);
        if (!found) throw new Error("listing not found");
        found.status = data.status;
        found.endedAt = data.endedAt;
        return { id: found.id };
      },
    },
    reviewTask: prisma.reviewTask,
    syncJob: prisma.syncJob,
    inventoryEvent: prisma.inventoryEvent,
  };
  const db: EbaySoldReconciliationPrismaLike = {
    inventoryItem: prisma.inventoryItem,
    marketplaceListing: {
      findMany: (args) => prisma.marketplaceListing.findMany(args),
      findFirst: async ({ where }) => {
        if (opts.failListingLookupOnce) {
          opts.failListingLookupOnce = false;
          throw new Error("temporary local lookup failure");
        }
        const match = prisma._store.listings.find((candidate) => {
          if (candidate.marketplace !== where.marketplace) return false;
          if ((candidate.environment ?? "production") !== where.environment) return false;
          if (candidate.externalListingId !== where.externalListingId) return false;
          const owner = prisma._store.items.find(
            (candidateItem) => candidateItem.id === candidate.inventoryItemId,
          );
          return owner?.accountId === where.inventoryItem.accountId;
        });
        const owner = match
          ? prisma._store.items.find((candidate) => candidate.id === match.inventoryItemId)
          : null;
        return match && owner
          ? {
              id: match.id,
              inventoryItemId: match.inventoryItemId,
              externalListingId: match.externalListingId,
              titleSnapshot: match.titleSnapshot,
              inventoryItem: {
                sellerId: owner.sellerId,
                accountId: owner.accountId ?? null,
                productName: owner.productName,
              },
            }
          : null;
      },
    },
    reviewTask: prisma.reviewTask,
    syncJob: prisma.syncJob,
    inventoryEvent: prisma.inventoryEvent,
    notification: prisma.notification,
    $transaction: (callback) => prisma.$transaction(async () => callback(transactionDb)),
    marketplaceSaleSignal,
  };
  return {
    db,
    prisma,
    rows,
  };
}

describe("classifyEbaySoldSignal", () => {
  it("requires verified paid, non-canceled, quantity-one order evidence", () => {
    expect(classifyEbaySoldSignal(baseSignal)).toBe("confirmed_sold");
    expect(classifyEbaySoldSignal({ ...baseSignal, verifiedSource: false })).toBe("uncertain");
    expect(classifyEbaySoldSignal({ ...baseSignal, paymentStatus: "PENDING" })).toBe("uncertain");
    expect(classifyEbaySoldSignal({ ...baseSignal, quantity: 2 })).toBe("uncertain");
  });

  it("distinguishes canceled and refunded orders", () => {
    expect(classifyEbaySoldSignal({ ...baseSignal, cancelState: "CANCELED" })).toBe("canceled");
    expect(classifyEbaySoldSignal({ ...baseSignal, paymentStatus: "FULLY_REFUNDED" })).toBe("refunded");
    expect(classifyEbaySoldSignal({ ...baseSignal, paymentStatus: "PARTIALLY_REFUNDED" })).toBe("uncertain");
  });
});

describe("reconcileEbaySoldSignal", () => {
  it("marks the canonical item and source listing sold, then queues other-channel cleanup", async () => {
    const { db, prisma, rows } = reconciliationDb();
    const result = await reconcileEbaySoldSignal(db, baseSignal);

    expect(result.outcome).toBe("marked_sold");
    expect(prisma._store.items[0]).toMatchObject({
      status: "SOLD",
      quantityAvailable: 0,
      soldSourceMarketplace: "ebay",
    });
    expect(prisma._store.listings.find((row) => row.id === "listing-ebay")).toMatchObject({
      status: "SOLD",
      endedAt: expect.any(Date),
    });
    expect(prisma._store.syncJobs).toHaveLength(1);
    expect(prisma._store.syncJobs[0]).toMatchObject({
      accountId: "account-1",
      marketplaceListingId: "listing-grailed",
      status: "needs_review",
    });
    expect(prisma._store.reviewTasks.some((task) => task.type === "manual_delist_required")).toBe(true);
    expect(prisma._store.notifications).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "marked_sold", inventoryItemId: "item-1" });
  });

  it("deduplicates a repeated external event without duplicating sale/delist evidence", async () => {
    const { db, prisma } = reconciliationDb();
    const first = await reconcileEbaySoldSignal(db, baseSignal);
    const second = await reconcileEbaySoldSignal(db, baseSignal);
    expect(first.outcome).toBe("marked_sold");
    expect(second).toMatchObject({ outcome: "duplicate", priorOutcome: "marked_sold" });
    expect(prisma._store.events.filter((event) => event.type === "sale_confirmed")).toHaveLength(1);
    expect(prisma._store.syncJobs).toHaveLength(1);
  });

  it("lets only one concurrent delivery hold a fresh processing lease", async () => {
    const { db, prisma } = reconciliationDb();
    const results = await Promise.all([
      reconcileEbaySoldSignal(db, baseSignal, {
        now: new Date("2026-07-11T12:00:00Z"),
        processingOwner: "worker-a",
      }),
      reconcileEbaySoldSignal(db, baseSignal, {
        now: new Date("2026-07-11T12:00:01Z"),
        processingOwner: "worker-b",
      }),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(
      expect.arrayContaining(["marked_sold", "duplicate"]),
    );
    expect(prisma._store.events.filter((event) => event.type === "sale_confirmed")).toHaveLength(1);
  });

  it("reclaims an incomplete signal only after its processing lease expires", async () => {
    const { db, prisma, rows } = reconciliationDb({ failListingLookupOnce: true });
    const startedAt = new Date("2026-07-11T12:00:00Z");
    await expect(
      reconcileEbaySoldSignal(db, baseSignal, {
        now: startedAt,
        processingOwner: "crashed-worker",
      }),
    ).rejects.toThrow("temporary local lookup failure");

    const stillLeased = await reconcileEbaySoldSignal(db, baseSignal, {
      now: new Date("2026-07-11T12:04:00Z"),
      processingOwner: "early-retry",
    });
    expect(stillLeased).toMatchObject({ outcome: "duplicate", priorOutcome: null });

    const recovered = await reconcileEbaySoldSignal(db, baseSignal, {
      now: new Date("2026-07-11T12:06:00Z"),
      processingOwner: "recovery-worker",
    });
    expect(recovered.outcome).toBe("marked_sold");
    expect(prisma._store.events.filter((event) => event.type === "sale_confirmed")).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "marked_sold",
      processingOwner: null,
      processingAttempts: 2,
    });
  });

  it("rejects an event-id replay whose immutable order identity changed", async () => {
    const { db } = reconciliationDb({ failListingLookupOnce: true });
    const now = new Date("2026-07-11T12:00:00Z");
    await expect(
      reconcileEbaySoldSignal(db, baseSignal, { now, processingOwner: "worker-a" }),
    ).rejects.toThrow("temporary local lookup failure");

    await expect(
      reconcileEbaySoldSignal(
        db,
        { ...baseSignal, externalOrderId: "different-order" },
        { now: new Date("2026-07-11T12:06:00Z"), processingOwner: "worker-b" },
      ),
    ).rejects.toMatchObject({ code: "SALE_SIGNAL_REPLAY_MISMATCH" });
  });

  it("keeps one winner when two distinct sold signals race", async () => {
    const { db, prisma } = reconciliationDb();
    const results = await Promise.all([
      reconcileEbaySoldSignal(db, baseSignal),
      reconcileEbaySoldSignal(db, {
        ...baseSignal,
        externalEventId: "order-1:line-1:v2",
      }),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(
      expect.arrayContaining(["marked_sold", "already_sold"]),
    );
    expect(prisma._store.events.filter((event) => event.type === "sale_confirmed")).toHaveLength(1);
    expect(prisma._store.syncJobs).toHaveLength(1);
  });

  it.each([
    ["CANCELED", "PAID", "ignored_canceled"],
    ["NONE_REQUESTED", "FULLY_REFUNDED", "ignored_refunded"],
  ] as const)("does not mark sold for %s/%s", async (cancelState, paymentStatus, outcome) => {
    const { db, prisma } = reconciliationDb();
    const result = await reconcileEbaySoldSignal(db, {
      ...baseSignal,
      cancelState,
      paymentStatus,
    });
    expect(result.outcome).toBe(outcome);
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.events.some((event) => event.type === "sale_rejected")).toBe(true);
  });

  it("creates review and notification evidence for an uncertain order", async () => {
    const { db, prisma } = reconciliationDb();
    const result = await reconcileEbaySoldSignal(db, {
      ...baseSignal,
      paymentStatus: "PENDING",
    });
    expect(result.outcome).toBe("review_uncertain");
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.reviewTasks[0].type).toBe("confirm_possible_sale");
    // Regression: without the source listing id in the payload, resolving the
    // task marked the item sold but left the eBay listing row LISTED.
    expect(prisma._store.reviewTasks[0].payload).toMatchObject({
      marketplaceListingId: "listing-ebay",
    });
    expect(prisma._store.notifications).toHaveLength(1);
  });

  it("does not cross account boundaries when matching the external listing", async () => {
    const { db, prisma } = reconciliationDb();
    const result = await reconcileEbaySoldSignal(db, {
      ...baseSignal,
      accountId: "other-account",
    });
    expect(result.outcome).toBe("review_unmatched");
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.syncJobs).toHaveLength(0);
  });

  it("matches an external listing only within the signal environment", async () => {
    const { db, prisma } = reconciliationDb({
      items: [
        item({ id: "production-item", accountId: "account-1" }),
        item({ id: "sandbox-item", accountId: "account-1", productName: "Sandbox item" }),
      ],
      listings: [
        listing({
          id: "production-listing",
          inventoryItemId: "production-item",
          marketplace: "ebay",
          environment: "production",
          externalListingId: "shared-external-id",
        }),
        listing({
          id: "sandbox-listing",
          inventoryItemId: "sandbox-item",
          marketplace: "ebay",
          environment: "sandbox",
          externalListingId: "shared-external-id",
        }),
      ],
    });

    const result = await reconcileEbaySoldSignal(db, {
      ...baseSignal,
      environment: "sandbox",
      externalListingId: "shared-external-id",
    });
    expect(result).toMatchObject({ outcome: "marked_sold", inventoryItemId: "sandbox-item" });
    expect(prisma._store.items.find((row) => row.id === "production-item")?.status).toBe("LISTED");
    expect(prisma._store.items.find((row) => row.id === "sandbox-item")?.status).toBe("SOLD");
  });

  it("keeps distinct unmatched eBay orders as distinct review tasks", async () => {
    const { db, prisma } = reconciliationDb({ listings: [] });
    await reconcileEbaySoldSignal(db, baseSignal);
    await reconcileEbaySoldSignal(db, {
      ...baseSignal,
      externalEventId: "order-2:line-1:v1",
      externalOrderId: "order-2",
    });
    expect(prisma._store.reviewTasks).toHaveLength(2);
    expect(prisma._store.reviewTasks.map((task) => task.dedupeKey)).toEqual([
      "ebay-unmatched:production:order-1:line-1",
      "ebay-unmatched:production:order-2:line-1",
    ]);
  });

  it("does not overwrite a listing already marked sold manually without a source", async () => {
    const { db, prisma } = reconciliationDb({
      items: [item({ status: "SOLD", quantityAvailable: 0, soldAt: new Date(), lockVersion: 1 })],
    });
    const result = await reconcileEbaySoldSignal(db, baseSignal);
    expect(result.outcome).toBe("conflict");
    expect(prisma._store.items[0].soldSourceMarketplace).toBeNull();
    expect(prisma._store.reviewTasks.some((task) => task.type === "sync_conflict")).toBe(true);
  });
});
