import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { createInventoryFakePrisma } from "@/lib/inventory/test-fake-prisma";

import { POST } from "./route";

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
      claimed: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      needsReview: 0,
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
    // Reaper requeued it, then the same run claimed + executed it.
    expect(payload.requeuedStale).toBe(1);
    expect(payload.failedStale).toBe(0);
    expect(payload.claimed).toBe(1);
    expect(payload.succeeded).toBe(1);
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
