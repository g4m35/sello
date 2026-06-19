import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { DELETE } from "./route";

function req(ids: unknown): Request {
  return new Request("http://localhost/api/listings", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

describe("DELETE /api/listings — live-listing delete safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: { findMany: mocks.findMany, deleteMany: mocks.deleteMany },
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const res = await DELETE(req(["a"]));
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("deletes safe drafts and reports live items as blocked, independently", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "a", marketplaceListings: [{ status: "NOT_LISTED" }] },
      { id: "b", marketplaceListings: [{ status: "LISTED" }] },
      { id: "c", marketplaceListings: [] },
      { id: "d", marketplaceListings: [{ status: "DELISTING" }] },
    ]);
    mocks.deleteMany.mockResolvedValue({ count: 2 });

    const res = await DELETE(req(["a", "b", "c", "d"]));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.deleted).toEqual(["a", "c"]);
    expect(payload.blocked).toEqual([
      { itemId: "b", reason: "LIVE_MARKETPLACE_LISTING" },
      { itemId: "d", reason: "LIVE_MARKETPLACE_LISTING" },
    ]);
    // Only the safe ids are passed to deleteMany; live ids never cascade.
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "c"] }, sellerId: "user-1" },
    });
  });

  it("scopes to the seller and never deletes when every item is live", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "b", marketplaceListings: [{ status: "LISTING" }] },
    ]);

    const res = await DELETE(req(["b", "unowned"]));
    const payload = await res.json();

    expect(payload.deleted).toEqual([]);
    expect(payload.blocked).toEqual([{ itemId: "b", reason: "LIVE_MARKETPLACE_LISTING" }]);
    // Unowned ids appear in neither bucket; findMany is seller-scoped.
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sellerId: "user-1" }) }),
    );
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
