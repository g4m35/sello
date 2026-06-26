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
    const res = await POST(req({}, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("WORKER_DISABLED");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-internal-secret header is missing", async () => {
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", SECRET);
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-internal-secret header does not match", async () => {
    vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", SECRET);
    const res = await POST(req({}, { "x-internal-secret": "wrong" }));
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

    const res = await POST(req({}, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
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

    const res = await POST(req(undefined, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.claimed).toBe(0);
  });

  it("malformed JSON body -> 400", async () => {
    const prisma = createInventoryFakePrisma({ items: [], syncJobs: [] });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(rawReq("{not json", { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error).toBeDefined();
  });

  it("malformed body shape (bad limit) -> 400", async () => {
    const prisma = createInventoryFakePrisma({ items: [], syncJobs: [] });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req({ limit: "lots" }, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(400);
  });
});
