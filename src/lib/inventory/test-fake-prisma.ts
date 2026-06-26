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
  endedAt?: Date | null;
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
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  runAfter: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

export type FakePrisma = SaleSignalPrismaLike & { _store: FakeStore };

export type FakeSyncJobSeed = {
  id: string;
  userId: string;
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
  payload?: unknown;
};

function seedSyncJob(seed: FakeSyncJobSeed): FakeSyncJob {
  return {
    id: seed.id,
    userId: seed.userId,
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
    payload: seed.payload ?? {},
  };
}

export function createInventoryFakePrisma(seed: {
  items: FakeItem[];
  listings?: FakeListing[];
  syncJobs?: FakeSyncJobSeed[];
}): FakePrisma {
  const store: FakeStore = {
    items: seed.items.map((i) => ({ ...i })),
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
      where: { id: string; sellerId: string };
      select: unknown;
    }) {
      const item = store.items.find(
        (i) => i.id === where.id && i.sellerId === where.sellerId,
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
        id?: string;
        marketplace?: Marketplace;
        inventoryItem?: { sellerId: string };
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
          if (!item || item.sellerId !== where.inventoryItem.sellerId) return false;
        }
        if (where.externalListingId && l.externalListingId !== where.externalListingId) {
          return false;
        }
        if (where.externalUrl && l.externalUrl !== where.externalUrl) return false;
        return true;
      });
      return match ? { ...match } : null;
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

  const jobSelectRow = (job: FakeSyncJob) => ({
    id: job.id,
    userId: job.userId,
    type: job.type,
    status: job.status,
    inventoryItemId: job.inventoryItemId,
    marketplaceListingId: job.marketplaceListingId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    payload: job.payload,
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
        status: string;
        OR?: Array<{ runAfter: null } | { runAfter: { lte: Date } }>;
        updatedAt?: { lte: Date };
      };
      select?: {
        id?: true;
        attempts?: true;
        maxAttempts?: true;
      };
      take?: number;
      orderBy?: unknown;
    }) {
      const now = new Date();
      // Reaper path: status + updatedAt<=cutoff, ordered by updatedAt, selecting
      // attempts/maxAttempts. Claim path: status + runAfter due, ordered by createdAt.
      const isStaleSweep = where.updatedAt !== undefined;
      const filtered = store.syncJobs.filter((j) => {
        if (j.status !== where.status) return false;
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
            ? { id: j.id, attempts: j.attempts, maxAttempts: j.maxAttempts }
            : { id: j.id },
        );
    },
    async updateMany({
      where,
      data,
    }: {
      where: { id: string; status: string };
      data: {
        status: string;
        attempts?: { increment: number };
        runAfter?: Date | null;
        errorCode?: string | null;
        errorMessage?: string | null;
      };
    }) {
      // Atomic conditional write: only flips a row still in the expected status.
      // Used by both the claim (queued->running) and the reaper (running->queued
      // or running->failed).
      const job = store.syncJobs.find(
        (j) => j.id === where.id && j.status === where.status,
      );
      if (!job) return { count: 0 };
      job.status = data.status;
      if (data.attempts) job.attempts += data.attempts.increment;
      if (data.runAfter !== undefined) job.runAfter = data.runAfter;
      if (data.errorCode !== undefined) job.errorCode = data.errorCode;
      if (data.errorMessage !== undefined) job.errorMessage = data.errorMessage;
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
      };
    }) {
      const job = store.syncJobs.find((j) => j.id === where.id);
      if (!job) throw new Error("job not found");
      if (data.status) job.status = data.status;
      if (data.attempts) job.attempts += data.attempts.increment;
      if (data.errorCode !== undefined) job.errorCode = data.errorCode;
      if (data.errorMessage !== undefined) job.errorMessage = data.errorMessage;
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
    async findFirst({
      where,
    }: {
      where: {
        userId: string;
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
          n.kind === where.kind &&
          n.title === where.title &&
          n.inventoryItemId === where.inventoryItemId &&
          n.readAt === null,
      );
      return index === -1 ? null : { id: `notif-${index + 1}` };
    },
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
        readAt: null,
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
