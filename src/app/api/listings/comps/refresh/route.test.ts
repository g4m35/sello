import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  runCompFetch: vi.fn(),
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 403 before database reads or provider work for a nonallowlisted seller", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });

    const response = await POST(
      new Request("http://localhost/api/listings/comps/refresh", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "item-1" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "PAID_COMPS_ALPHA_ONLY",
        message: "Fresh sold comps are currently enabled for selected alpha accounts.",
      },
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
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

  it("runs provider fetch only for an explicit seller-scoped refresh", async () => {
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
      where: { id: "item-1", sellerId: "user-1" },
      select: { id: true },
    });
    expect(mocks.runCompFetch).toHaveBeenCalledWith(
      prisma,
      "item-1",
      "user-1",
      { force: true, paidProvidersAllowed: true },
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
