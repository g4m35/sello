import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  runCompFetch: vi.fn(),
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

vi.mock("@/lib/comps/fetch", () => ({
  runCompFetch: mocks.runCompFetch,
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

import { AppError } from "@/lib/errors";

import { POST } from "./route";

describe("explicit comp refresh route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PAID_COMPS_EMAILS", "allowed@example.com");
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com",
    });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.reserveUsageOrThrow.mockResolvedValue({
      reservationId: "usage-reservation-1",
      idempotent: false,
      status: "reserved",
    });
    mocks.releaseUsageReservation.mockResolvedValue(true);
    mocks.markUsageWorkStarted.mockResolvedValue(true);
    mocks.markUsageReconciliationRequired.mockResolvedValue(true);
    mocks.settleUsageReservationOrRequireReconciliation.mockResolvedValue("settled");
    mocks.requireRuntimeFeatureAccess.mockResolvedValue({
      account: { id: "acc-1", ownerUserId: "user-1", plan: "free" },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 402 and does not fetch when the monthly comp-refresh quota is exhausted", async () => {
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      compSearchRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.reserveUsageOrThrow.mockRejectedValue(
      new AppError(
        "You have used all of your comp refreshes for this billing period. Upgrade your plan for more.",
        402,
        "QUOTA_EXCEEDED_COMP_REFRESH",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(402);
    expect((await response.json()).error.code).toBe("QUOTA_EXCEEDED_COMP_REFRESH");
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
    expect(mocks.settleUsageReservationOrRequireReconciliation).not.toHaveBeenCalled();
  });

  it("returns 403 before database reads or provider work for a nonallowlisted seller", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.requireRuntimeFeatureAccess.mockRejectedValueOnce(
      new AppError(
        "This feature is currently available to selected beta accounts.",
        403,
        "ALPHA_OR_BETA_ACCESS_REQUIRED",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "ALPHA_OR_BETA_ACCESS_REQUIRED",
        message: "This feature is currently available to selected beta accounts.",
      },
    });
    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
  });

  it("returns a safe non-500 response before DB, ledger, or provider work when paid providers are disabled", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "");

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "PAID_COMPS_DISABLED",
        message: "Fresh sold comps are disabled right now. Manual comps still work.",
      },
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
  });

  it("runs provider fetch only for an explicit account-scoped refresh", async () => {
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      compSearchRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runCompFetch.mockResolvedValue({ accepted: 1, rejected: 0 });

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", accountId: "acc-1" },
      select: { id: true },
    });
    expect(mocks.runCompFetch).toHaveBeenCalledWith(
      prisma,
      "item-1",
      "user-1",
      {
        force: true,
        paidProvidersAllowed: true,
        accountId: "acc-1",
        adminOverride: false,
        idempotencyKey: expect.any(String),
      },
    );
  });

  it("returns only sanitized provider failure details", async () => {
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      compSearchRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runCompFetch.mockResolvedValue({
      status: "error",
      sourceErrors: [
        {
          source: "apify-ebay-sold",
          message: "Paid comp provider failed. Try again later.",
        },
      ],
    });

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Paid comp provider failed. Try again later.");
    expect(body).not.toContain("token");
    expect(body).not.toContain("Authorization");
  });

  it("never leaks a raw Prisma error (void deserialization regression)", async () => {
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      compSearchRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    const voidError = new Error(
      "Inconsistent column data: Failed to deserialize column of type 'void'. " +
        "Invocation: SELECT pg_advisory_xact_lock(...). token=tok_live_secret_123",
    );
    voidError.name = "PrismaClientKnownRequestError";
    mocks.runCompFetch.mockRejectedValue(voidError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    const payload = JSON.parse(body);
    expect(payload.error.code).toBe("COMPS_REFRESH_FAILED");
    expect(payload.error.message).toContain("Manual comps still work");
    // No raw Prisma / void / query / stack / token text reaches the response.
    expect(body).not.toContain("void");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("deserialize");
    expect(body).not.toContain("pg_advisory");
    expect(body).not.toContain("tok_live_secret");
    expect(body).not.toContain("Invocation");
    // And the raw message is not echoed into logs either.
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("tok_live_secret");
    consoleError.mockRestore();
  });

  it("returns 429 and does not fetch when a comp run is within the cooldown", async () => {
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      compSearchRun: {
        findFirst: vi.fn().mockResolvedValue({ createdAt: new Date() }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
  });

  it("applies the 60s owner cooldown so an admin can refresh past a long seller cooldown", async () => {
    // Seller cooldown is configured long (1h); an owner/alpha must only wait 60s.
    vi.stubEnv("COMPS_REFRESH_COOLDOWN_SECONDS", "3600");
    vi.stubEnv("ADMIN_EMAILS", "allowed@example.com");
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      compSearchRun: {
        // Last run 70s ago: still inside the 1h seller window, past the 60s owner cap.
        findFirst: vi
          .fn()
          .mockResolvedValue({ createdAt: new Date(Date.now() - 70_000) }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runCompFetch.mockResolvedValue({ accepted: 0, rejected: 0 });

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runCompFetch).toHaveBeenCalledOnce();
  });

  it("still enforces the long seller cooldown for a non-admin within 60s..1h", async () => {
    vi.stubEnv("COMPS_REFRESH_COOLDOWN_SECONDS", "3600");
    // No ADMIN_EMAILS: this seller is not an owner.
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      compSearchRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ createdAt: new Date(Date.now() - 70_000) }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
  });

  it("only counts a real provider run for the cooldown so a disabled/failed/skipped run never poisons it", async () => {
    // No prior *real* run -> the refresh is allowed even if a disabled/failed
    // auto run wrote a CompSearchRun moments ago.
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      compSearchRun: { findFirst },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runCompFetch.mockResolvedValue({ status: "found_comps" });

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.runCompFetch).toHaveBeenCalledOnce();
    // The cooldown query is restricted to statuses that actually queried a
    // provider; blocked/failed runs are excluded and can never lock out a retry.
    const where = findFirst.mock.calls[0][0].where;
    expect(where.inventoryItemId).toBe("item-1");
    expect(where.status.in).toEqual(
      expect.arrayContaining(["found_comps", "auto_priced", "no_comps_found", "needs_review"]),
    );
    expect(where.status.in).not.toContain("disabled");
    expect(where.status.in).not.toContain("error");
    expect(where.status.in).not.toContain("skipped_weak_identity");
    expect(where.status.in).not.toContain("source_unavailable");
  });

  it("does not run provider fetch for another seller's item", async () => {
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
  });
});
