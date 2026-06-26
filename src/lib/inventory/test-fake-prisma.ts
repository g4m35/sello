import type {
  InventoryStatus,
  Marketplace,
  MarketplaceListingStatus,
} from "@/generated/prisma/client";

import type { SaleSignalPrismaLike } from "./sale-signal";

// Shared in-memory Prisma fake for the inventory-safety integration tests
// (delist, mark-sold, sale-signal). It models just the surface those modules
// touch, mirroring the per-test fakes used by publish-handler/delist-handler.
// No real DB, no network. `$transaction` runs the callback inline against the
// same store so the lockVersion guard is exercised.

export type FakeItem = {
  id: string;
  sellerId: string;
  productName: string;
  status: InventoryStatus;
  soldAt: Date | null;
  quantityAvailable: number;
  soldSourceMarketplace: Marketplace | null;
  soldSourceListingId: string | null;
  lockVersion: number;
};

export type FakeListing = {
  id: string;
  inventoryItemId: string;
  marketplace: Marketplace;
  status: MarketplaceListingStatus;
  externalListingId: string | null;
  externalUrl: string | null;
  titleSnapshot: string | null;
};

export type FakeReviewTask = {
  id: string;
  userId: string;
  type: string;
  status: string;
  inventoryItemId: string | null;
  marketplace: Marketplace | null;
  title: string;
  description: string;
  payload: unknown;
};

export type FakeSyncJob = {
  id: string;
  userId: string;
  type: string;
  status: string;
  inventoryItemId: string | null;
  marketplaceListingId: string | null;
  idempotencyKey: string;
  attempts: number;
  payload: unknown;
};

export type FakeEvent = {
  inventoryItemId: string;
  userId: string;
  type: string;
  source: string;
  marketplace: Marketplace | null;
  confidence: number | null;
  payload: unknown;
};

export type FakeNotification = {
  userId: string;
  kind: string;
  title: string;
  body: string;
  inventoryItemId: string | null;
};

export type FakeStore = {
  items: FakeItem[];
  listings: FakeListing[];
  reviewTasks: FakeReviewTask[];
  syncJobs: FakeSyncJob[];
  events: FakeEvent[];
  notifications: FakeNotification[];
};

export type FakePrisma = SaleSignalPrismaLike & { _store: FakeStore };

export function createInventoryFakePrisma(seed: {
  items: FakeItem[];
  listings?: FakeListing[];
}): FakePrisma {
  const store: FakeStore = {
    items: seed.items.map((i) => ({ ...i })),
    listings: (seed.listings ?? []).map((l) => ({ ...l })),
    reviewTasks: [],
    syncJobs: [],
    events: [],
    notifications: [],
  };

  const inventoryItem = {
    async findFirst({
      where,
    }: {
      where: { id: string; sellerId: string };
      select: unknown;
    }) {
      const item = store.items.find(
        (i) => i.id === where.id && i.sellerId === where.sellerId,
      );
      return item ? { ...item } : null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string; lockVersion?: number };
      data: {
        status?: InventoryStatus;
        quantityAvailable?: number;
        soldAt?: Date;
        soldSourceMarketplace?: Marketplace;
        soldSourceListingId?: string | null;
        lockVersion?: { increment: number };
      };
    }) {
      const item = store.items.find((i) => i.id === where.id);
      if (!item) {
        throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      }
      // Emulate the optimistic-concurrency guard: an update with a lockVersion
      // in `where` only matches when the stored version still equals it.
      if (where.lockVersion !== undefined && item.lockVersion !== where.lockVersion) {
        throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      }
      if (data.status !== undefined) item.status = data.status;
      if (data.quantityAvailable !== undefined) {
        item.quantityAvailable = data.quantityAvailable;
      }
      if (data.soldAt !== undefined) item.soldAt = data.soldAt;
      if (data.soldSourceMarketplace !== undefined) {
        item.soldSourceMarketplace = data.soldSourceMarketplace;
      }
      if (data.soldSourceListingId !== undefined) {
        item.soldSourceListingId = data.soldSourceListingId;
      }
      if (data.lockVersion?.increment) {
        item.lockVersion += data.lockVersion.increment;
      }
      return { id: item.id };
    },
  };

  const marketplaceListing = {
    async findMany({
      where,
    }: {
      where: {
        inventoryItemId?: string;
        marketplace?: Marketplace;
        inventoryItem?: { sellerId: string };
      };
      select: unknown;
    }) {
      return store.listings
        .filter((l) => {
          if (where.inventoryItemId && l.inventoryItemId !== where.inventoryItemId) {
            return false;
          }
          if (where.marketplace && l.marketplace !== where.marketplace) return false;
          if (where.inventoryItem) {
            const item = store.items.find((i) => i.id === l.inventoryItemId);
            if (!item || item.sellerId !== where.inventoryItem.sellerId) return false;
          }
          return true;
        })
        .map((l) => ({ ...l }));
    },
    async findFirst({
      where,
    }: {
      where: {
        marketplace: Marketplace;
        inventoryItem: { sellerId: string };
        externalListingId?: string;
        externalUrl?: string;
      };
      select: unknown;
    }) {
      const match = store.listings.find((l) => {
        if (l.marketplace !== where.marketplace) return false;
        const item = store.items.find((i) => i.id === l.inventoryItemId);
        if (!item || item.sellerId !== where.inventoryItem.sellerId) return false;
        if (where.externalListingId && l.externalListingId !== where.externalListingId) {
          return false;
        }
        if (where.externalUrl && l.externalUrl !== where.externalUrl) return false;
        return true;
      });
      return match ? { ...match } : null;
    },
  };

  const reviewTask = {
    async findFirst({
      where,
    }: {
      where: {
        userId: string;
        type: string;
        status: string;
        inventoryItemId: string | null;
        marketplace: Marketplace | null;
      };
      select: { id: true };
    }) {
      const found = store.reviewTasks.find(
        (t) =>
          t.userId === where.userId &&
          t.type === where.type &&
          t.status === where.status &&
          t.inventoryItemId === where.inventoryItemId &&
          t.marketplace === where.marketplace,
      );
      return found ? { id: found.id } : null;
    },
    async create({
      data,
    }: {
      data: {
        userId: string;
        type: string;
        inventoryItemId?: string | null;
        marketplace?: Marketplace | null;
        title: string;
        description: string;
        payload: unknown;
      };
    }) {
      const task: FakeReviewTask = {
        id: `task-${store.reviewTasks.length + 1}`,
        userId: data.userId,
        type: data.type,
        status: "open",
        inventoryItemId: data.inventoryItemId ?? null,
        marketplace: data.marketplace ?? null,
        title: data.title,
        description: data.description,
        payload: data.payload,
      };
      store.reviewTasks.push(task);
      return { id: task.id };
    },
  };

  const syncJob = {
    async upsert({
      where,
      create,
    }: {
      where: { idempotencyKey: string };
      update: Record<string, never>;
      create: {
        userId: string;
        type: string;
        status: string;
        inventoryItemId?: string | null;
        marketplaceListingId?: string | null;
        idempotencyKey: string;
        payload: unknown;
      };
      select: unknown;
    }) {
      const existing = store.syncJobs.find(
        (j) => j.idempotencyKey === where.idempotencyKey,
      );
      if (existing) {
        return {
          id: existing.id,
          type: existing.type,
          status: existing.status,
          idempotencyKey: existing.idempotencyKey,
          attempts: existing.attempts,
        };
      }
      const job: FakeSyncJob = {
        id: `job-${store.syncJobs.length + 1}`,
        userId: create.userId,
        type: create.type,
        status: create.status,
        inventoryItemId: create.inventoryItemId ?? null,
        marketplaceListingId: create.marketplaceListingId ?? null,
        idempotencyKey: create.idempotencyKey,
        attempts: 0,
        payload: create.payload,
      };
      store.syncJobs.push(job);
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        idempotencyKey: job.idempotencyKey,
        attempts: job.attempts,
      };
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { status?: string; attempts?: { increment: number } };
    }) {
      const job = store.syncJobs.find((j) => j.id === where.id);
      if (!job) throw new Error("job not found");
      if (data.status) job.status = data.status;
      if (data.attempts) job.attempts += data.attempts.increment;
      return { id: job.id };
    },
  };

  const inventoryEvent = {
    async create({
      data,
    }: {
      data: {
        inventoryItemId: string;
        userId: string;
        type: string;
        source: string;
        marketplace?: Marketplace | null;
        confidence?: number | null;
        payload: unknown;
      };
    }) {
      store.events.push({
        inventoryItemId: data.inventoryItemId,
        userId: data.userId,
        type: data.type,
        source: data.source,
        marketplace: data.marketplace ?? null,
        confidence: data.confidence ?? null,
        payload: data.payload,
      });
      return { id: `event-${store.events.length}` };
    },
  };

  const notification = {
    async create({
      data,
    }: {
      data: {
        userId: string;
        kind: string;
        title: string;
        body: string;
        inventoryItemId?: string | null;
      };
    }) {
      store.notifications.push({
        userId: data.userId,
        kind: data.kind,
        title: data.title,
        body: data.body,
        inventoryItemId: data.inventoryItemId ?? null,
      });
      return { id: `notif-${store.notifications.length}` };
    },
  };

  const base = {
    inventoryItem,
    marketplaceListing,
    reviewTask,
    syncJob,
    inventoryEvent,
    notification,
  };

  const prisma = {
    _store: store,
    ...base,
    async $transaction<T>(callback: (tx: typeof base) => Promise<T>): Promise<T> {
      return callback(base);
    },
  };

  return prisma as unknown as FakePrisma;
}
