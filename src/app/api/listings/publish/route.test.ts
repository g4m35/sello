import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { publishingMigrationMissingCode } from "@/lib/marketplace/publish-handler";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  executePublish: vi.fn(),
  executePublishActual: undefined as
    | undefined
    | ((...args: unknown[]) => Promise<unknown>),
  getActiveAccount: vi.fn(),
  requireRuntimeFeatureAccess: vi.fn(),
  markUsageReconciliationRequired: vi.fn(),
  markUsageWorkStarted: vi.fn(),
  releaseUsageReservation: vi.fn(),
  reserveUsageOrThrow: vi.fn(),
  settleUsageReservationOrRequireReconciliation: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/auth/feature-access", () => ({
  requireRuntimeFeatureAccess: mocks.requireRuntimeFeatureAccess,
}));
vi.mock("@/lib/billing/usage", () => ({
  markUsageReconciliationRequired: mocks.markUsageReconciliationRequired,
  markUsageWorkStarted: mocks.markUsageWorkStarted,
  releaseUsageReservation: mocks.releaseUsageReservation,
  reserveUsageOrThrow: mocks.reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation:
    mocks.settleUsageReservationOrRequireReconciliation,
}));

vi.mock("@/lib/marketplace/publish-handler", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/marketplace/publish-handler")
  >();
  mocks.executePublishActual = actual.executePublish as typeof mocks.executePublishActual;
  return { ...actual, executePublish: mocks.executePublish };
});

import { POST } from "./route";

describe("publish API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EBAY_ENV", "sandbox");
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "allowed@example.com");
    mocks.executePublish.mockReset();
    mocks.executePublish.mockImplementation(mocks.executePublishActual!);
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "kingpin" });
    mocks.requireRuntimeFeatureAccess.mockResolvedValue({
      account: { id: "acc-1", ownerUserId: "user-1", plan: "kingpin" },
    });
    mocks.reserveUsageOrThrow.mockResolvedValue({
      reservationId: "usage-reservation-1",
      idempotent: false,
      status: "reserved",
    });
    mocks.releaseUsageReservation.mockResolvedValue(true);
    mocks.markUsageWorkStarted.mockResolvedValue(true);
    mocks.markUsageReconciliationRequired.mockResolvedValue(true);
    mocks.settleUsageReservationOrRequireReconciliation.mockResolvedValue("settled");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 402 and does not publish when the autopublish quota is exhausted", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    mocks.reserveUsageOrThrow.mockRejectedValue(
      new AppError(
        "You have used all of your autopublishes for this billing period. Upgrade your plan for more.",
        402,
        "QUOTA_EXCEEDED_AUTOPUBLISH",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "11111111-1111-4111-8111-111111111111", marketplace: "ebay" }),
      }),
    );

    expect(response.status).toBe(402);
    expect((await response.json()).error.code).toBe("QUOTA_EXCEEDED_AUTOPUBLISH");
    expect(mocks.executePublish).not.toHaveBeenCalled();
    expect(mocks.settleUsageReservationOrRequireReconciliation).not.toHaveBeenCalled();
  });

  it("does not release the original reservation for a duplicate request", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({});
    mocks.requireRuntimeFeatureAccess.mockRejectedValueOnce(
      new AppError(
        "This feature is currently available to selected beta accounts.",
        403,
        "ALPHA_OR_BETA_ACCESS_REQUIRED",
      ),
    );
    mocks.reserveUsageOrThrow.mockResolvedValue({
      reservationId: "usage-reservation-in-flight",
      idempotent: true,
      status: "reserved",
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        headers: { "idempotency-key": "request-key-123" },
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("USAGE_REQUEST_ALREADY_RESERVED");
    expect(mocks.executePublish).not.toHaveBeenCalled();
    expect(mocks.releaseUsageReservation).not.toHaveBeenCalled();
  });

  it("rejects publish attempts when the seller is not signed in", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "x", marketplace: "ebay" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: {
        code: "REQUEST_FAILED",
        message: "Sign in before creating a listing draft.",
      },
    });
  });

  it("rejects authenticated sellers outside the live publish alpha before side effects", async () => {
    const prismaWrite = vi.fn();
    const outboundAdapter = vi.fn();
    vi.stubEnv("EBAY_ENV", "production");
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({});
    mocks.executePublish.mockImplementationOnce(async () => {
      prismaWrite();
      outboundAdapter();
      throw new Error("publish should not execute");
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      error: {
        code: "ALPHA_OR_BETA_ACCESS_REQUIRED",
        message: "This feature is currently available to selected beta accounts.",
      },
    });
    expect(mocks.executePublish).not.toHaveBeenCalled();
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(prismaWrite).not.toHaveBeenCalled();
    expect(outboundAdapter).not.toHaveBeenCalled();
  });

  it("allows nonallowlisted sellers to reach sandbox eBay publishing", async () => {
    const prisma = {};
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.executePublish.mockResolvedValueOnce({
      outcome: {
        status: "not_enabled",
        code: "EBAY_PUBLISH_NOT_ENABLED",
        marketplace: "ebay",
        environment: "sandbox",
        message: "disabled",
      },
      httpStatus: 200,
      marketplaceListingId: "listing-1",
      publishAttemptId: "attempt-1",
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          marketplace: "ebay",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.executePublish).toHaveBeenCalledWith(prisma, {
      userId: "user-1",
      accountId: "acc-1",
      inventoryItemId: "11111111-1111-4111-8111-111111111111",
      marketplace: "ebay",
    });
  });

  it("allows nonallowlisted sellers to reach draft-only non-eBay publishing", async () => {
    const prisma = {};
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.executePublish.mockResolvedValueOnce({
      outcome: {
        status: "not_implemented",
        code: "NOT_IMPLEMENTED",
        marketplace: "grailed",
        reason: "Draft-only marketplace.",
      },
      httpStatus: 501,
      marketplaceListingId: "listing-2",
      publishAttemptId: "attempt-2",
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "22222222-2222-4222-8222-222222222222",
          marketplace: "grailed",
        }),
      }),
    );

    expect(response.status).toBe(501);
    expect(mocks.executePublish).toHaveBeenCalledWith(prisma, {
      userId: "user-1",
      accountId: "acc-1",
      inventoryItemId: "22222222-2222-4222-8222-222222222222",
      marketplace: "grailed",
    });
  });

  it("preserves a non-2xx publish outcome when usage release fails", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
    mocks.getPrisma.mockReturnValue({});
    mocks.releaseUsageReservation.mockRejectedValue(new Error("temporary database failure"));
    mocks.executePublish.mockResolvedValueOnce({
      outcome: {
        status: "not_implemented",
        code: "NOT_IMPLEMENTED",
        marketplace: "grailed",
        reason: "Draft-only marketplace.",
      },
      httpStatus: 501,
      marketplaceListingId: "listing-2",
      publishAttemptId: "attempt-2",
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "22222222-2222-4222-8222-222222222222",
          marketplace: "grailed",
        }),
      }),
    );

    expect(response.status).toBe(501);
    expect((await response.json()).code).toBe("NOT_IMPLEMENTED");
  });

  it("returns a typed setup error when publish persistence tables are missing", async () => {
    const inventoryItemId = "11111111-1111-4111-8111-111111111111";

    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: inventoryItemId, status: "APPROVED" }),
      },
      marketplaceListing: {
        upsert: vi.fn().mockResolvedValue({ id: "listing-1" }),
      },
      publishAttempt: {
        create: vi.fn().mockRejectedValue({
          code: "P2021",
          message: 'The table `public.PublishAttempt` does not exist.',
        }),
      },
      marketplaceEvent: {
        create: vi.fn(),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId, marketplace: "ebay" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: publishingMigrationMissingCode,
        message:
          "Publishing persistence is not ready yet. Apply the migration that creates PublishAttempt and MarketplaceEvent, then retry. Nothing was published.",
        missingTables: ["PublishAttempt", "MarketplaceEvent"],
      },
    });
  });

  it("surfaces EBAY_PUBLISH_NOT_ENABLED for eBay while publishing is disabled", async () => {
    const inventoryItemId = "22222222-2222-4222-8222-222222222222";
    vi.stubEnv("EBAY_SANDBOX_PUBLISH_ENABLED", "false");

    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: inventoryItemId, status: "APPROVED" }),
      },
      marketplaceListing: {
        upsert: vi.fn().mockResolvedValue({ id: "listing-1" }),
      },
      publishAttempt: {
        create: vi.fn().mockResolvedValue({ id: "attempt-1" }),
      },
      marketplaceEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-1" }),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId, marketplace: "ebay" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.code).toBe("EBAY_PUBLISH_NOT_ENABLED");
    expect(payload.marketplaceListingId).toBe("listing-1");
    expect(payload.publishAttemptId).toBe("attempt-1");

  });

  it("rejects production eBay live publish attempts while the production flag is off", async () => {
    const inventoryItemId = "44444444-4444-4444-8444-444444444444";
    vi.stubEnv("EBAY_ENV", "production");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "false");

    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: inventoryItemId, status: "APPROVED" }),
      },
      marketplaceListing: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "listing-prod-1" }),
        update: vi.fn().mockResolvedValue({ id: "listing-prod-1" }),
      },
      publishAttempt: {
        create: vi.fn().mockResolvedValue({ id: "attempt-prod-1" }),
        update: vi.fn().mockResolvedValue({ id: "attempt-prod-1" }),
      },
      marketplaceEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-prod-1" }),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId, marketplace: "ebay" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe("EBAY_PUBLISH_NOT_ENABLED");
    expect(payload.marketplaceListingId).toBe("listing-prod-1");
    expect(payload.publishAttemptId).toBe("attempt-prod-1");

  });

  it("leaves non-eBay marketplaces as a typed NOT_IMPLEMENTED 501", async () => {
    const inventoryItemId = "33333333-3333-4333-8333-333333333333";

    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: inventoryItemId, status: "APPROVED" }),
      },
      marketplaceListing: {
        upsert: vi.fn().mockResolvedValue({ id: "listing-9" }),
      },
      publishAttempt: {
        create: vi.fn().mockResolvedValue({ id: "attempt-9" }),
      },
      marketplaceEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-9" }),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId, marketplace: "grailed" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(501);
    expect(payload.code).toBe("NOT_IMPLEMENTED");
  });
});
