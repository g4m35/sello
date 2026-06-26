import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireUser: vi.fn(),
  markItemSold: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireUser,
}));
vi.mock("@/lib/inventory/mark-sold", () => ({ markItemSold: mocks.markItemSold }));

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function req(body: unknown): Request {
  return new Request("http://localhost/api/inventory/mark-sold", {
    method: "POST",
    headers: { authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/inventory/mark-sold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication before touching the engine", async () => {
    mocks.requireUser.mockRejectedValue(new AppError("Sign in.", 401));
    const res = await POST(req({ inventoryItemId: ITEM_ID, soldMarketplace: "grailed" }));
    expect(res.status).toBe(401);
    expect(mocks.markItemSold).not.toHaveBeenCalled();
  });

  it("calls markItemSold with the signed-in user id and source manual", async () => {
    mocks.markItemSold.mockResolvedValue({
      outcome: "marked_sold",
      inventoryItemId: ITEM_ID,
      soldMarketplace: "grailed",
      delist: { queuedJobIds: ["j1"], manualReviewTaskIds: [], skippedSoldSource: true },
    });

    const res = await POST(
      req({
        inventoryItemId: ITEM_ID,
        soldMarketplace: "grailed",
        soldListingId: "g-123",
        soldPriceCents: 24000,
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.result.outcome).toBe("marked_sold");
    expect(mocks.markItemSold).toHaveBeenCalledTimes(1);
    expect(mocks.markItemSold.mock.calls[0][1]).toEqual({
      inventoryItemId: ITEM_ID,
      userId: "user-1",
      soldMarketplace: "grailed",
      soldListingId: "g-123",
      soldPriceCents: 24000,
      source: "manual",
    });
  });

  it("surfaces the engine's 404 (ownership) without leaking internals", async () => {
    mocks.markItemSold.mockRejectedValue(new AppError("Inventory item not found.", 404));
    const res = await POST(req({ inventoryItemId: ITEM_ID, soldMarketplace: "ebay" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Inventory item not found.");
  });

  it("rejects an invalid marketplace with a 400 before calling the engine", async () => {
    const res = await POST(req({ inventoryItemId: ITEM_ID, soldMarketplace: "myspace" }));
    expect(res.status).toBe(400);
    expect(mocks.markItemSold).not.toHaveBeenCalled();
  });
});
