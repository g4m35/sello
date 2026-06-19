import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

const req = () => new Request("http://localhost/api/admin/marketplace-operations");

function attemptsPrisma() {
  return {
    publishAttempt: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "a1",
          code: "EBAY_PUBLISH_SUCCEEDED",
          status: "SUCCEEDED",
          requestedBy: "seller-1",
          createdAt: new Date("2026-06-18T00:00:00.000Z"),
          adapterResult: {
            bulkRunId: "bulk-1",
            ebayError: { message: "raw provider secret detail" },
            token: "tok_should_not_leak",
          },
          marketplaceListing: {
            externalListingId: "1100123",
            environment: "production",
            sku: "percs_item1",
            inventoryItem: {
              id: "item-1",
              productName: "TNF Nuptse",
              listingDrafts: [{ title: "The North Face Nuptse Jacket" }],
            },
          },
        },
        {
          id: "a2",
          code: "EBAY_DELIST_SUCCEEDED",
          status: "SUCCEEDED",
          requestedBy: "seller-2",
          createdAt: new Date("2026-06-17T00:00:00.000Z"),
          adapterResult: null,
          marketplaceListing: {
            externalListingId: null,
            environment: "production",
            sku: "percs_item2",
            inventoryItem: { id: "item-2", productName: "Jordan 1", listingDrafts: [] },
          },
        },
        {
          id: "a3",
          code: "EBAY_ORPHAN_CLEANUP_SUCCEEDED",
          status: "SUCCEEDED",
          requestedBy: "seller-3",
          createdAt: new Date("2026-06-16T00:00:00.000Z"),
          adapterResult: {},
          marketplaceListing: {
            externalListingId: null,
            environment: "production",
            sku: "percs_item3",
            inventoryItem: { id: "item-3", productName: "Item 3", listingDrafts: [] },
          },
        },
      ]),
    },
  };
}

describe("GET /api/admin/marketplace-operations", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    expect((await GET(req())).status).toBe(401);
  });

  it("returns 404 for a non-admin (does not reveal the admin surface)", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
    expect((await GET(req())).status).toBe(404);
  });

  it("returns configured allowlists and mapped safe attempts for an admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@sello.com");
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "alpha@example.com");
    vi.stubEnv("EBAY_DELIST_EMAILS", "delist@example.com");
    vi.stubEnv("PAID_COMPS_EMAILS", "comps@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@sello.com" });
    mocks.getPrisma.mockReturnValue(attemptsPrisma());

    const res = await GET(req());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.access.liveEbayPublish).toContain("alpha@example.com");
    expect(payload.access.ebayDelist).toContain("delist@example.com");
    expect(payload.access.paidComps).toContain("comps@example.com");

    expect(payload.attempts).toHaveLength(3);
    expect(payload.attempts[0]).toMatchObject({
      id: "a1",
      requestedBy: "seller-1",
      itemId: "item-1",
      itemTitle: "The North Face Nuptse Jacket",
      action: "publish",
      status: "SUCCEEDED",
      code: "EBAY_PUBLISH_SUCCEEDED",
      bulkRunId: "bulk-1",
      externalListingId: "1100123",
      createdAt: "2026-06-18T00:00:00.000Z",
    });
    expect(payload.attempts[1].action).toBe("delist");
    expect(payload.attempts[2].action).toBe("cleanup");

    // No adapter payloads, tokens, environment values, raw errors, or SKUs.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("raw provider secret detail");
    expect(serialized).not.toContain("tok_should_not_leak");
    expect(serialized).not.toContain("adapterResult");
    expect(serialized).not.toContain("production");
    expect(serialized).not.toContain("percs_item1");
  });

  it("returns 503 when the publish attempt table is missing", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@sello.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@sello.com" });
    mocks.getPrisma.mockReturnValue({
      publishAttempt: { findMany: vi.fn().mockRejectedValue({ code: "P2021" }) },
    });
    expect((await GET(req())).status).toBe(503);
  });
});
