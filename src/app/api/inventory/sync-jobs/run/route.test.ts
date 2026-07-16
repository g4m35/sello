import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getUserById: vi.fn(),
  requireRuntimeFeatureAccess: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/auth/feature-access", () => ({
  requireRuntimeFeatureAccess: mocks.requireRuntimeFeatureAccess,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById } },
  }),
}));

import { createInventoryFakePrisma } from "@/lib/inventory/test-fake-prisma";
import { AppError } from "@/lib/errors";

import { createProductionExecutionGate, POST } from "./route";

const SECRET = "test-worker-secret-value";

function req(body: unknown | undefined, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/inventory/sync-jobs/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// A raw-body request so we can send malformed JSON.
function rawReq(raw: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/inventory/sync-jobs/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
}

describe("POST /api/inventory/sync-jobs/run — secret gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("returns 503 when the worker secret env is unset", async () => {
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", "");
    const res = await POST(req({}, { "x-inventory-sync-worker-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WORKER_DISABLED");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-inventory-sync-worker-secret header is missing", async () => {
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", SECRET);
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-inventory-sync-worker-secret header does not match", async () => {
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", SECRET);
    const res = await POST(req({}, { "x-inventory-sync-worker-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });
});

describe("POST /api/inventory/sync-jobs/run — execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", SECRET);
    mocks.getUserById.mockResolvedValue({
      data: { user: { id: "user-1", email: "seller@example.com" } },
      error: null,
    });
    mocks.requireRuntimeFeatureAccess.mockResolvedValue({
      account: { id: "account-1" },
    });
    mocks.getActiveAccount.mockResolvedValue({ id: "account-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("valid secret runs the worker and returns a sanitized summary", async () => {
    const prisma = createInventoryFakePrisma({
      items: [
        {
          id: "item-1",
          sellerId: "user-1",
          productName: "Nike Air Max 1",
          status: "LISTED",
          soldAt: null,
          quantityAvailable: 1,
          soldSourceMarketplace: null,
          soldSourceListingId: null,
          lockVersion: 0,
        },
      ],
      syncJobs: [
        {
          id: "j-1",
          userId: "user-1",
          type: "create_review_task",
          status: "queued",
          inventoryItemId: "item-1",
          payload: {
            type: "manual_delist_required",
            inventoryItemId: "item-1",
            marketplace: "poshmark",
            title: "Remove listing",
            description: "Please remove your listing.",
          },
        },
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req({}, { "x-inventory-sync-worker-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      requeuedStale: 0,
      failedStale: 0,
      reconciliationRequiredAttempts: 0,
      claimed: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      needsReview: 0,
      retryWait: 0,
    });
    // Sanitized: no job payloads or secrets leak into the response.
    expect(JSON.stringify(payload)).not.toContain("idem");
    expect(JSON.stringify(payload)).not.toContain("poshmark");
  });

  it("accepts an empty body (no jobs => zeroed summary)", async () => {
    const prisma = createInventoryFakePrisma({ items: [], syncJobs: [] });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req(undefined, { "x-inventory-sync-worker-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.claimed).toBe(0);
  });

  it("malformed JSON body -> 400", async () => {
    const prisma = createInventoryFakePrisma({ items: [], syncJobs: [] });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(rawReq("{not json", { "x-inventory-sync-worker-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error).toBeDefined();
  });

  it("malformed body shape (bad limit) -> 400", async () => {
    const prisma = createInventoryFakePrisma({ items: [], syncJobs: [] });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req({ limit: "lots" }, { "x-inventory-sync-worker-secret": SECRET }));
    expect(res.status).toBe(400);
  });

  it("supplies the production authorization gate before an eBay worker delist", async () => {
    const prisma = createInventoryFakePrisma({
      items: [
        {
          id: "item-1",
          sellerId: "user-1",
          accountId: "account-1",
          productName: "Nike Air Max 1",
          status: "SOLD",
          soldAt: new Date(),
          quantityAvailable: 0,
          soldSourceMarketplace: "stockx",
          soldSourceListingId: "stockx-1",
          lockVersion: 1,
        },
      ],
      listings: [
        {
          id: "listing-ebay",
          inventoryItemId: "item-1",
          marketplace: "ebay",
          status: "LISTED",
          externalListingId: "ebay-listing-1",
          externalUrl: null,
          titleSnapshot: "Nike Air Max 1",
          endedAt: null,
        },
      ],
      syncJobs: [
        {
          id: "job-ebay",
          userId: "user-1",
          accountId: "account-1",
          type: "delist_marketplace_listing",
          inventoryItemId: "item-1",
          marketplaceListingId: "listing-ebay",
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "listing-ebay",
            marketplace: "ebay",
            accountId: "account-1",
            soldMarketplace: "stockx",
          },
        },
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireRuntimeFeatureAccess.mockResolvedValueOnce({
      account: { id: "different-account" },
    });

    const res = await POST(req({}, { "x-inventory-sync-worker-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({ claimed: 1, needsReview: 1, succeeded: 0 });
    expect(mocks.getUserById).toHaveBeenCalledWith("user-1");
    expect(mocks.requireRuntimeFeatureAccess).toHaveBeenCalledWith(
      { id: "user-1", email: "seller@example.com" },
      "ebayDelist",
      prisma,
    );
    expect(prisma._store.syncJobs[0]).toMatchObject({
      status: "needs_review",
      errorCode: "WORKER_ACCOUNT_SCOPE_MISMATCH",
    });
    expect(prisma._store.events.some((event) => event.type === "delist_succeeded"))
      .toBe(false);
  });
});

describe("createProductionExecutionGate", () => {
  it("authorizes eBay only after verified identity, entitlement, and account scope", async () => {
    const requireEbayDelistAccess = vi.fn().mockResolvedValue({ id: "account-1" });
    const resolveActiveAccount = vi.fn();
    const gate = createProductionExecutionGate({} as never, {
      resolveUserById: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "seller@example.com",
      }),
      requireEbayDelistAccess,
      resolveActiveAccount,
    });

    await expect(
      gate({
        jobId: "job-1",
        userId: "user-1",
        accountId: "account-1",
        inventoryItemId: "item-1",
        marketplaceListingId: "listing-1",
        marketplace: "ebay",
        operation: "delist",
      }),
    ).resolves.toMatchObject({ allowed: true, code: "WORKER_EXECUTION_AUTHORIZED" });
    expect(requireEbayDelistAccess).toHaveBeenCalledWith({
      id: "user-1",
      email: "seller@example.com",
    });
    expect(resolveActiveAccount).not.toHaveBeenCalled();
  });

  it("returns seller-safe denial copy and never authorizes a rejected entitlement", async () => {
    const gate = createProductionExecutionGate({} as never, {
      resolveUserById: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "seller@example.com",
      }),
      requireEbayDelistAccess: vi.fn().mockRejectedValue(
        new AppError("Live eBay delisting is unavailable for this account.", 403, "DENIED"),
      ),
      resolveActiveAccount: vi.fn(),
    });

    await expect(
      gate({
        jobId: "job-1",
        userId: "user-1",
        accountId: "account-1",
        inventoryItemId: "item-1",
        marketplaceListingId: "listing-1",
        marketplace: "ebay",
        operation: "delist",
      }),
    ).resolves.toEqual({
      allowed: false,
      code: "DENIED",
      sellerCopy: "Live eBay delisting is unavailable for this account.",
    });
  });

  it("authorizes StockX status sync only for the verified active account", async () => {
    const resolveActiveAccount = vi.fn().mockResolvedValue({ id: "account-1" });
    const requireEbayDelistAccess = vi.fn();
    const gate = createProductionExecutionGate({} as never, {
      resolveUserById: vi.fn().mockResolvedValue({ id: "user-1" }),
      requireEbayDelistAccess,
      resolveActiveAccount,
    });

    await expect(
      gate({
        jobId: "job-1",
        userId: "user-1",
        accountId: "account-1",
        inventoryItemId: "item-1",
        marketplaceListingId: "listing-1",
        marketplace: "stockx",
        operation: "status_sync",
      }),
    ).resolves.toMatchObject({ allowed: true });
    expect(resolveActiveAccount).toHaveBeenCalledWith("user-1");
    expect(requireEbayDelistAccess).not.toHaveBeenCalled();
  });
});

describe("POST /api/inventory/sync-jobs/run — stale-running reaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  const HOUR_AGO = () => new Date(Date.now() - 60 * 60_000);

  it("requeueStale:true requeues a stale job then runs it, returning counts", async () => {
    const prisma = createInventoryFakePrisma({
      items: [
        {
          id: "item-1",
          sellerId: "user-1",
          productName: "Nike Air Max 1",
          status: "LISTED",
          soldAt: null,
          quantityAvailable: 1,
          soldSourceMarketplace: null,
          soldSourceListingId: null,
          lockVersion: 0,
        },
      ],
      syncJobs: [
        {
          id: "j-stale",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 1,
          maxAttempts: 5,
          inventoryItemId: "item-1",
          updatedAt: HOUR_AGO(),
          payload: {
            kind: "sold_delisting",
            title: "Sold",
            body: "Your item sold.",
            inventoryItemId: "item-1",
          },
        },
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(
      req(
        { limit: 10, requeueStale: true, staleOlderThanMinutes: 15 },
        { "x-inventory-sync-worker-secret": SECRET },
      ),
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    // Reaper parks it with backoff; a later run claims it after runAfter.
    expect(payload.requeuedStale).toBe(1);
    expect(payload.failedStale).toBe(0);
    expect(payload.claimed).toBe(0);
    expect(payload.succeeded).toBe(0);
    expect(prisma._store.syncJobs[0].status).toBe("retry_wait");
  });

  it("requeueStale:false (default) does not touch stale jobs", async () => {
    const prisma = createInventoryFakePrisma({
      items: [],
      syncJobs: [
        {
          id: "j-stale",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 1,
          maxAttempts: 5,
          updatedAt: HOUR_AGO(),
        },
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req({}, { "x-inventory-sync-worker-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.requeuedStale).toBe(0);
    expect(payload.failedStale).toBe(0);
    expect(prisma._store.syncJobs[0].status).toBe("running");
  });

  it("clamps staleOlderThanMinutes below 5 up to the safe minimum (>=5)", async () => {
    // A job updated 2 min ago must NOT be requeued when caller passes minutes:0;
    // proves the reaper window was clamped server-side to >= 5 minutes.
    const prisma = createInventoryFakePrisma({
      items: [],
      syncJobs: [
        {
          id: "j-recent",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 1,
          maxAttempts: 5,
          updatedAt: new Date(Date.now() - 2 * 60_000),
        },
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(
      req(
        { requeueStale: true, staleOlderThanMinutes: 0 },
        { "x-inventory-sync-worker-secret": SECRET },
      ),
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.requeuedStale).toBe(0);
    expect(prisma._store.syncJobs[0].status).toBe("running");
  });

  it("limit stays bounded (over-max limit -> 400)", async () => {
    const prisma = createInventoryFakePrisma({ items: [], syncJobs: [] });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(
      req(
        { limit: 999, requeueStale: true },
        { "x-inventory-sync-worker-secret": SECRET },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("response never leaks payloads or secrets", async () => {
    const prisma = createInventoryFakePrisma({
      items: [],
      syncJobs: [
        {
          id: "j-stale",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 5,
          maxAttempts: 5,
          updatedAt: HOUR_AGO(),
          payload: { kind: "secret-kind", title: "poshmark" },
        },
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(
      req({ requeueStale: true }, { "x-inventory-sync-worker-secret": SECRET }),
    );
    const payload = await res.json();

    expect(payload.failedStale).toBe(1);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("poshmark");
    expect(serialized).not.toContain("secret-kind");
    expect(serialized).not.toContain(SECRET);
  });
});
