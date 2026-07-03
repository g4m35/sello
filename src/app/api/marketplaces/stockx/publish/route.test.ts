import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  getPrisma: vi.fn(),
  assertWithinQuota: vi.fn(),
  incrementUsage: vi.fn(),
  executePublish: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));
vi.mock("@/lib/billing/usage", () => ({
  assertWithinQuota: mocks.assertWithinQuota,
  incrementUsage: mocks.incrementUsage,
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("@/lib/marketplace/publish-handler", () => ({
  executePublish: mocks.executePublish,
  PublishingMigrationMissingError: class PublishingMigrationMissingError extends Error {
    status = 503;
    toPayload() {
      return { code: "PUBLISHING_MIGRATION_MISSING" };
    }
  },
}));

import { POST } from "./route";

const itemId = "00000000-0000-4000-8000-000000000001";

describe("StockX publish route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-1",
      ownerUserId: "user-1",
      plan: "kingpin",
    });
    mocks.getPrisma.mockReturnValue({ db: true });
    mocks.assertWithinQuota.mockResolvedValue(undefined);
    mocks.incrementUsage.mockResolvedValue(undefined);
    mocks.executePublish.mockResolvedValue({
      outcome: {
        status: "submitted",
        code: "STOCKX_LISTING_SUBMITTED",
        marketplace: "stockx",
        environment: "production",
        listingId: "stockx-listing-1",
      },
      httpStatus: 202,
      marketplaceListingId: "listing-1",
      publishAttemptId: "attempt-1",
      listingId: "stockx-listing-1",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an authenticated seller", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in first.", 401));

    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId, confirmLivePublish: true }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.executePublish).not.toHaveBeenCalled();
  });

  it("requires explicit live StockX confirmation before running the publish service", async () => {
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId }),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("STOCKX_CONFIRMATION_REQUIRED");
    expect(mocks.executePublish).not.toHaveBeenCalled();
  });

  it("delegates confirmed StockX publishes to the canonical audited publish handler", async () => {
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId, confirmLivePublish: true }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.executePublish).toHaveBeenCalledWith(
      { db: true },
      {
        userId: "user-1",
        accountId: "acc-1",
        inventoryItemId: itemId,
        marketplace: "stockx",
        confirmLivePublish: true,
      },
    );
    expect((await response.json()).code).toBe("STOCKX_LISTING_SUBMITTED");
  });

  it("burns quota only after the publish handler returns a successful 2xx response", async () => {
    await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId, confirmLivePublish: true }),
      }),
    );

    expect(mocks.assertWithinQuota).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acc-1" }),
      "autopublish",
      expect.any(Date),
    );
    expect(mocks.incrementUsage).toHaveBeenCalledWith(
      "acc-1",
      "autopublish",
      expect.any(Date),
    );
  });
});
