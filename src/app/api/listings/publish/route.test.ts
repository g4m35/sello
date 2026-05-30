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
});
