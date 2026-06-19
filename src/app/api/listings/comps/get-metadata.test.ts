import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { GET } from "./route";

describe("comps GET metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: null });
  });

  it("returns the latest run metadata and cooldown remaining", async () => {
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      priceComp: { findMany: vi.fn().mockResolvedValue([]) },
      compSearchRun: {
        findFirst: vi.fn().mockResolvedValue({
          status: "found_comps",
          queries: ["the north face nuptse sold"],
          sourceErrors: [],
          createdAt: new Date(),
          acceptedCount: 4,
          rejectedCount: 1,
        }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await GET(
      new Request("http://localhost/api/listings/comps?inventoryItemId=item-1"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.inventoryItemId).toBe("item-1");
    expect(payload.discovery.status).toBe("found_comps");
    expect(payload.discovery.lastRunAt).toBeTruthy();
    expect(payload.discovery.acceptedCount).toBe(4);
    // A run that just happened is within the default cooldown window.
    expect(payload.discovery.cooldownSecondsRemaining).toBeGreaterThan(0);
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", sellerId: "user-1" },
      select: { id: true },
    });
  });
});
