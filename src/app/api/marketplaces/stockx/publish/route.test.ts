import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import {
  StockXIntegrationError,
  stockxErrorCodes,
} from "@/lib/marketplace/adapters/stockx/errors";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  getPrisma: vi.fn(),
  markUsageReconciliationRequired: vi.fn(),
  markUsageWorkStarted: vi.fn(),
  releaseUsageReservation: vi.fn(),
  reserveUsageOrThrow: vi.fn(),
  settleUsageReservationOrRequireReconciliation: vi.fn(),
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
  markUsageReconciliationRequired: mocks.markUsageReconciliationRequired,
  markUsageWorkStarted: mocks.markUsageWorkStarted,
  releaseUsageReservation: mocks.releaseUsageReservation,
  reserveUsageOrThrow: mocks.reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation:
    mocks.settleUsageReservationOrRequireReconciliation,
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
    mocks.reserveUsageOrThrow.mockResolvedValue({
      reservationId: "usage-reservation-1",
      idempotent: false,
      status: "reserved",
    });
    mocks.releaseUsageReservation.mockResolvedValue(true);
    mocks.markUsageWorkStarted.mockResolvedValue(true);
    mocks.markUsageReconciliationRequired.mockResolvedValue(true);
    mocks.settleUsageReservationOrRequireReconciliation.mockResolvedValue("settled");
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

    expect(mocks.reserveUsageOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-1",
        metric: "autopublish",
        user: { id: "user-1" },
      }),
      { db: true },
    );
    expect(mocks.settleUsageReservationOrRequireReconciliation).toHaveBeenCalledWith(
      "usage-reservation-1",
      expect.any(Date),
      "STOCKX_AUTOPUBLISH_SETTLEMENT_FAILED",
      { db: true },
    );
  });

  it("preserves a non-2xx publish outcome when usage release fails", async () => {
    mocks.releaseUsageReservation.mockRejectedValue(new Error("temporary database failure"));
    mocks.executePublish.mockResolvedValue({
      outcome: {
        status: "not_enabled",
        code: "STOCKX_PUBLISH_NOT_ENABLED",
        marketplace: "stockx",
        environment: "production",
      },
      httpStatus: 409,
      marketplaceListingId: "listing-1",
      publishAttemptId: "attempt-1",
    });

    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId, confirmLivePublish: true }),
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("STOCKX_PUBLISH_NOT_ENABLED");
  });

  it("returns safe StockX provider failure details for live publish diagnostics", async () => {
    mocks.executePublish.mockRejectedValue(
      new StockXIntegrationError(
        stockxErrorCodes.listingFailed,
        "StockX API request failed.",
        502,
        { status: 400 },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId, confirmLivePublish: true }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toEqual({
      code: "STOCKX_LISTING_FAILED",
      message: "StockX API request failed.",
      details: { status: 400 },
    });
    expect(mocks.settleUsageReservationOrRequireReconciliation).not.toHaveBeenCalled();
  });
});
