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
  accountId?: string;
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
  environment?: string;
  status: MarketplaceListingStatus;
  externalListingId: string | null;
  externalUrl: string | null;
  titleSnapshot: string | null;
  endedAt?: Date | null;
};

export type FakeReviewTask = {
  id: string;
  userId: string;
  accountId: string | null;
  type: string;
  status: string;
  inventoryItemId: string | null;
  marketplace: Marketplace | null;
  title: string;
  description: string;
  payload: unknown;
  dedupeKey: string | null;
};

export type FakeSyncJob = {
  id: string;
  userId: string;
  accountId: string | null;
  type: string;
  status: string;
  inventoryItemId: string | null;
  marketplaceListingId: string | null;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  runAfter: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  leaseOwner: string | null;
  retryClass: string | null;
  completedAt: Date | null;
  payload: unknown;
};

export type FakeEvent = {
  inventoryItemId: string;
  userId: string;
  accountId: string | null;
  type: string;
  source: string;
  marketplace: Marketplace | null;
  confidence: number | null;
  payload: unknown;
};

export type FakeNotification = {
  id: string;
  userId: string;
  accountId: string | null;
  kind: string;
  title: string;
  body: string;
  inventoryItemId: string | null;
  dedupeKey: string | null;
  readAt: Date | null;
};

export type FakeStore = {
  items: FakeItem[];
  listings: FakeListing[];
  reviewTasks: FakeReviewTask[];
  syncJobs: FakeSyncJob[];
  events: FakeEvent[];
  notifications: FakeNotification[];
};

export type FakePrisma = SaleSignalPrismaLike & {
  _store: FakeStore;
  marketplaceListing: SaleSignalPrismaLike["marketplaceListing"] & {
    update(args: {
      where: { id: string };
      data: { endedAt?: Date; status?: MarketplaceListingStatus };
    }): Promise<{ id: string }>;
  };
};

export type FakeSyncJobSeed = {
  id: string;
  userId: string;
  accountId?: string | null;
  type: string;
  status?: string;
  inventoryItemId?: string | null;
  marketplaceListingId?: string | null;
  idempotencyKey?: string;
  attempts?: number;
  maxAttempts?: number;
  runAfter?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  lockedAt?: Date | null;
  leaseOwner?: string | null;
  payload?: unknown;
};

function seedSyncJob(seed: FakeSyncJobSeed): FakeSyncJob {
  return {
    id: seed.id,
    userId: seed.userId,
    accountId: seed.accountId ?? "account-1",
    type: seed.type,
    status: seed.status ?? "queued",
    inventoryItemId: seed.inventoryItemId ?? null,
    marketplaceListingId: seed.marketplaceListingId ?? null,
    idempotencyKey: seed.idempotencyKey ?? `idem-${seed.id}`,
    attempts: seed.attempts ?? 0,
    maxAttempts: seed.maxAttempts ?? 5,
    errorCode: null,
    errorMessage: null,
    runAfter: seed.runAfter ?? null,
    createdAt: seed.createdAt ?? new Date(),
    // Mirrors Prisma @updatedAt. Seedable so a test can backdate a 'running' row
    // to make it look stale to the reaper.
    updatedAt: seed.updatedAt ?? seed.createdAt ?? new Date(),
    lockedAt: seed.lockedAt ?? (seed.status === "running" ? new Date() : null),
    leaseOwner: seed.leaseOwner ?? (seed.status === "running" ? "seed-lease" : null),
    retryClass: null,
    completedAt: null,
    payload: seed.payload ?? {},
  };
}

export function createInventoryFakePrisma(seed: {
  items: FakeItem[];
  listings?: FakeListing[];
  syncJobs?: FakeSyncJobSeed[];
}): FakePrisma {
  const store: FakeStore = {
    items: seed.items.map((i) => ({
      ...i,
      accountId: i.accountId ?? `account-${i.sellerId}`,
    })),
    listings: (seed.listings ?? []).map((l) => ({ endedAt: null, ...l })),
    reviewTasks: [],
    syncJobs: (seed.syncJobs ?? []).map(seedSyncJob),
    events: [],
    notifications: [],
  };

  const inventoryItem = {
    async findFirst({
      where,
    }: {
      where: { id: string; sellerId?: string; accountId?: string };
      select: unknown;
    }) {
      const item = store.items.find(
        (i) =>
          i.id === where.id &&
          (where.sellerId === undefined || i.sellerId === where.sellerId) &&
          (where.accountId === undefined || i.accountId === where.accountId),
      );
      return item ? { ...item } : null;
    },
    async findUnique({ where }: { where: { id: string }; select?: unknown }) {
      const item = store.items.find((i) => i.id === where.id);
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
        soldSourceMarketplace?: Marketplace | null;
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
      // Return the full updated row (real Prisma update returns the record), so
      // routes that surface the result directly (e.g. lifecycle 'delist') work.
      return { ...item };
    },
  };

  const marketplaceListing = {
    async findMany({
      where,
    }: {
      where: {
        inventoryItemId?: string;
        marketplace?: Marketplace;
        inventoryItem?: { id?: string; sellerId?: string; accountId?: string };
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
            if (!item) return false;
            if (
              where.inventoryItem.sellerId !== undefined &&
              item.sellerId !== where.inventoryItem.sellerId
            ) {
              return false;
            }
            if (
              where.inventoryItem.accountId !== undefined &&
              item.accountId !== where.inventoryItem.accountId
            ) {
              return false;
            }
          }
          return true;
        })
        .map((l) => ({
          ...l,
          inventoryItem: store.items.find((i) => i.id === l.inventoryItemId),
        }));
    },
    async findFirst({
      where,
    }: {
      where: {
        id?: string;
        marketplace?: Marketplace;
        inventoryItem?: { id?: string; sellerId?: string; accountId?: string };
        externalListingId?: string;
        externalUrl?: string;
      };
      select: unknown;
    }) {
      const match = store.listings.find((l) => {
        if (where.id && l.id !== where.id) return false;
        if (where.marketplace && l.marketplace !== where.marketplace) return false;
        if (where.inventoryItem) {
          const item = store.items.find((i) => i.id === l.inventoryItemId);
          if (!item) return false;
          if (where.inventoryItem.id !== undefined && item.id !== where.inventoryItem.id) {
            return false;
          }
          if (
            where.inventoryItem.sellerId !== undefined &&
            item.sellerId !== where.inventoryItem.sellerId
          ) {
            return false;
          }
          if (
            where.inventoryItem.accountId !== undefined &&
            item.accountId !== where.inventoryItem.accountId
          ) {
            return false;
          }
        }
        if (where.externalListingId && l.externalListingId !== where.externalListingId) {
          return false;
        }
        if (where.externalUrl && l.externalUrl !== where.externalUrl) return false;
        return true;
      });
      return match
        ? {
            ...match,
            inventoryItem: store.items.find((i) => i.id === match.inventoryItemId),
          }
        : null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { endedAt?: Date; status?: MarketplaceListingStatus };
    }) {
      const listing = store.listings.find((l) => l.id === where.id);
      if (!listing) throw new Error("listing not found");
      if (data.endedAt !== undefined) listing.endedAt = data.endedAt;
      if (data.status !== undefined) listing.status = data.status;
      return { id: listing.id };
    },
  };

  const reviewTask = {
    async findFirst({
      where,
    }: {
      where: {
        userId?: string;
        accountId?: string;
        type: string;
        status: string;
        inventoryItemId: string | null;
        marketplace?: Marketplace | null;
        dedupeKey?: string;
      };
      select: { id: true };
    }) {
      const found = store.reviewTasks.find(
        (t) =>
          (where.accountId === undefined || t.accountId === where.accountId) &&
          (where.userId === undefined || t.userId === where.userId) &&
          t.type === where.type &&
          t.status === where.status &&
          t.inventoryItemId === where.inventoryItemId &&
          (where.marketplace === undefined || t.marketplace === where.marketplace) &&
          (where.dedupeKey === undefined || t.dedupeKey === where.dedupeKey),
      );
      return found ? { id: found.id } : null;
    },
    async create({
      data,
    }: {
      data: {
        userId: string;
        accountId?: string | null;
        type: string;
        inventoryItemId?: string | null;
        marketplace?: Marketplace | null;
        title: string;
        description: string;
        payload: unknown;
        dedupeKey?: string | null;
      };
    }) {
      const accountId = data.accountId ?? null;
      const dedupeKey = data.dedupeKey ?? null;
      if (
        dedupeKey !== null &&
        store.reviewTasks.some(
          (task) => task.accountId === accountId && task.dedupeKey === dedupeKey,
        )
      ) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const task: FakeReviewTask = {
        id: `task-${store.reviewTasks.length + 1}`,
        userId: data.userId,
        accountId,
        type: data.type,
        status: "open",
        inventoryItemId: data.inventoryItemId ?? null,
        marketplace: data.marketplace ?? null,
        title: data.title,
        description: data.description,
        payload: data.payload,
        dedupeKey,
      };
      store.reviewTasks.push(task);
      return { id: task.id };
    },
  };

  const jobSelectRow = (job: FakeSyncJob) => ({
    id: job.id,
    userId: job.userId,
    accountId: job.accountId,
    type: job.type,
    status: job.status,
    inventoryItemId: job.inventoryItemId,
    marketplaceListingId: job.marketplaceListingId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    errorCode: job.errorCode,
    retryClass: job.retryClass,
    payload: job.payload,
    leaseOwner: job.leaseOwner,
  });

  const syncJob = {
    async upsert({
      where,
      create,
    }: {
      where: { idempotencyKey: string };
      update: Record<string, never>;
      create: {
        userId: string;
        accountId?: string | null;
        type: string;
        status: string;
        inventoryItemId?: string | null;
        marketplaceListingId?: string | null;
        idempotencyKey: string;
        payload: unknown;
        runAfter?: Date | null;
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
        accountId: create.accountId ?? null,
        type: create.type,
        status: create.status,
        inventoryItemId: create.inventoryItemId ?? null,
        marketplaceListingId: create.marketplaceListingId ?? null,
        idempotencyKey: create.idempotencyKey,
        attempts: 0,
        maxAttempts: 5,
        errorCode: null,
        errorMessage: null,
        runAfter: create.runAfter ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lockedAt: null,
        leaseOwner: null,
        retryClass: null,
        completedAt: null,
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
    async findMany({
      where,
      select,
      take,
    }: {
      where: {
        status: string | { in: readonly string[] };
        OR?: Array<{ runAfter: null } | { runAfter: { lte: Date } }>;
        updatedAt?: { lte: Date };
      };
      select?: {
        id?: true;
        type?: true;
        attempts?: true;
        maxAttempts?: true;
        leaseOwner?: true;
      };
      take?: number;
      orderBy?: unknown;
    }) {
      const now = new Date();
      // Reaper path: status + updatedAt<=cutoff, ordered by updatedAt, selecting
      // attempts/maxAttempts. Claim path: status + runAfter due, ordered by createdAt.
      const isStaleSweep = where.updatedAt !== undefined;
      const filtered = store.syncJobs.filter((j) => {
        const expectedStatuses =
          typeof where.status === "string" ? [where.status] : where.status.in;
        if (!expectedStatuses.includes(j.status)) return false;
        if (where.updatedAt) {
          return j.updatedAt <= where.updatedAt.lte;
        }
        // Due when runAfter is null or in the past.
        return j.runAfter === null || j.runAfter <= now;
      });
      const sorted = filtered.sort((a, b) =>
        isStaleSweep
          ? a.updatedAt.getTime() - b.updatedAt.getTime()
          : a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const wantsAttempts = select?.attempts === true;
      return sorted
        .slice(0, take ?? store.syncJobs.length)
        .map((j) =>
          wantsAttempts
            ? {
                id: j.id,
                type: j.type,
                attempts: j.attempts,
                maxAttempts: j.maxAttempts,
                leaseOwner: j.leaseOwner,
              }
            : { id: j.id },
        );
    },
    async updateMany({
      where,
      data,
    }: {
      where: {
        id: string;
        status: string | { in: readonly string[] };
        leaseOwner?: string;
      };
      data: {
        status?: string;
        attempts?: { increment: number };
        runAfter?: Date | null;
        errorCode?: string | null;
        errorMessage?: string | null;
        lockedAt?: Date | null;
        leaseOwner?: string | null;
        retryClass?: string | null;
        completedAt?: Date | null;
      };
    }) {
      // Atomic conditional write: only flips a row still in the expected status.
      // Used by both the claim (queued->running) and the reaper (running->queued
      // or running->failed).
      const expectedStatuses =
        typeof where.status === "string" ? [where.status] : where.status.in;
      const job = store.syncJobs.find(
        (j) =>
          j.id === where.id &&
          expectedStatuses.includes(j.status) &&
          (where.leaseOwner === undefined || j.leaseOwner === where.leaseOwner),
      );
      if (!job) return { count: 0 };
      if (data.status !== undefined) job.status = data.status;
      if (data.attempts) job.attempts += data.attempts.increment;
      if (data.runAfter !== undefined) job.runAfter = data.runAfter;
      if (data.errorCode !== undefined) job.errorCode = data.errorCode;
      if (data.errorMessage !== undefined) job.errorMessage = data.errorMessage;
      if (data.lockedAt !== undefined) job.lockedAt = data.lockedAt;
      if (data.leaseOwner !== undefined) job.leaseOwner = data.leaseOwner;
      if (data.retryClass !== undefined) job.retryClass = data.retryClass;
      if (data.completedAt !== undefined) job.completedAt = data.completedAt;
      job.updatedAt = new Date();
      return { count: 1 };
    },
    async findFirst({
      where,
    }: {
      where: { id: string };
      select: unknown;
    }) {
      const job = store.syncJobs.find((j) => j.id === where.id);
      return job ? jobSelectRow(job) : null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: {
        status?: string;
        attempts?: { increment: number };
        errorCode?: string | null;
        errorMessage?: string | null;
        runAfter?: Date | null;
        lockedAt?: Date | null;
        leaseOwner?: string | null;
        retryClass?: string | null;
        completedAt?: Date | null;
      };
    }) {
      const job = store.syncJobs.find((j) => j.id === where.id);
      if (!job) throw new Error("job not found");
      if (data.status) job.status = data.status;
      if (data.attempts) job.attempts += data.attempts.increment;
      if (data.errorCode !== undefined) job.errorCode = data.errorCode;
      if (data.errorMessage !== undefined) job.errorMessage = data.errorMessage;
      if (data.runAfter !== undefined) job.runAfter = data.runAfter;
      if (data.lockedAt !== undefined) job.lockedAt = data.lockedAt;
      if (data.leaseOwner !== undefined) job.leaseOwner = data.leaseOwner;
      if (data.retryClass !== undefined) job.retryClass = data.retryClass;
      if (data.completedAt !== undefined) job.completedAt = data.completedAt;
      job.updatedAt = new Date();
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
        accountId?: string | null;
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
        accountId: data.accountId ?? null,
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
    async findFirst({
      where,
    }: {
      where: {
        userId: string;
        accountId?: string | null;
        kind: string;
        title: string;
        inventoryItemId: string | null;
        readAt: null;
      };
      select: { id: true };
    }) {
      const index = store.notifications.findIndex(
        (n) =>
          n.userId === where.userId &&
          (where.accountId === undefined || n.accountId === where.accountId) &&
          n.kind === where.kind &&
          n.title === where.title &&
          n.inventoryItemId === where.inventoryItemId &&
          n.readAt === null,
      );
      return index === -1 ? null : { id: store.notifications[index].id };
    },
    async create({
      data,
    }: {
      data: {
        userId: string;
        accountId?: string | null;
        kind: string;
        title: string;
        body: string;
        inventoryItemId?: string | null;
        dedupeKey?: string | null;
      };
    }) {
      const accountId = data.accountId ?? null;
      const dedupeKey = data.dedupeKey ?? null;
      if (
        dedupeKey !== null &&
        store.notifications.some(
          (notification) =>
            notification.accountId === accountId && notification.dedupeKey === dedupeKey,
        )
      ) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const id = `notif-${store.notifications.length + 1}`;
      store.notifications.push({
        id,
        userId: data.userId,
        accountId,
        kind: data.kind,
        title: data.title,
        body: data.body,
        inventoryItemId: data.inventoryItemId ?? null,
        dedupeKey,
        readAt: null,
      });
      return { id };
    },
    async upsert({
      where,
      create,
    }: {
      where: {
        accountId_dedupeKey: { accountId: string; dedupeKey: string };
      };
      update: Record<string, never>;
      create: {
        userId: string;
        accountId: string;
        kind: string;
        title: string;
        body: string;
        inventoryItemId?: string | null;
        dedupeKey?: string | null;
      };
    }) {
      const key = where.accountId_dedupeKey;
      const existing = store.notifications.find(
        (notification) =>
          notification.accountId === key.accountId &&
          notification.dedupeKey === key.dedupeKey,
      );
      if (existing) return { id: existing.id };
      return notification.create({ data: create });
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
  let transactionTail = Promise.resolve();

  const prisma = {
    _store: store,
    ...base,
    async $transaction<T>(callback: (tx: typeof base) => Promise<T>): Promise<T> {
      let release = () => {};
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshot = structuredClone(store);
      try {
        return await callback(base);
      } catch (error) {
        store.items.splice(0, store.items.length, ...snapshot.items);
        store.listings.splice(0, store.listings.length, ...snapshot.listings);
        store.reviewTasks.splice(0, store.reviewTasks.length, ...snapshot.reviewTasks);
        store.syncJobs.splice(0, store.syncJobs.length, ...snapshot.syncJobs);
        store.events.splice(0, store.events.length, ...snapshot.events);
        store.notifications.splice(0, store.notifications.length, ...snapshot.notifications);
        throw error;
      } finally {
        release();
      }
    },
  };

  return prisma as unknown as FakePrisma;
}
