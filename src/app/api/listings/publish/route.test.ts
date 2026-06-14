import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { publishingMigrationMissingCode } from "@/lib/marketplace/publish-handler";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { POST } from "./route";

describe("publish API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("returns a typed setup error when publish persistence tables are missing", async () => {
    const inventoryItemId = "11111111-1111-4111-8111-111111111111";

    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
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

    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
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

    vi.unstubAllEnvs();
  });

  it("rejects production eBay live publish attempts while the production flag is off", async () => {
    const inventoryItemId = "44444444-4444-4444-8444-444444444444";
    vi.stubEnv("EBAY_ENV", "production");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "false");

    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
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

    vi.unstubAllEnvs();
  });

  it("leaves non-eBay marketplaces as a typed NOT_IMPLEMENTED 501", async () => {
    const inventoryItemId = "33333333-3333-4333-8333-333333333333";

    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
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
