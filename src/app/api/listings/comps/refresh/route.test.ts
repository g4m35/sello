import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  runCompFetch: vi.fn(),
}));

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
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
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
      { force: true },
    );
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
