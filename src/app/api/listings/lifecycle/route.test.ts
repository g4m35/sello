import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

describe("item lifecycle API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
  });

  it("rejects lifecycle changes when the seller is not signed in", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );
    const response = await POST(
      new Request("http://localhost/api/listings/lifecycle", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "x", action: "mark_sold" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("scopes lifecycle changes to the active account", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: ITEM_ID, status: "APPROVED" });
    const update = vi.fn().mockResolvedValue({ id: ITEM_ID, status: "SOLD" });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: { findFirst, update },
    });

    const response = await POST(
      new Request("http://localhost/api/listings/lifecycle", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: ITEM_ID, action: "mark_sold" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: ITEM_ID, accountId: "acc-1" },
      select: { id: true, status: true },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: expect.objectContaining({ status: "SOLD" }),
      }),
    );
  });
});
