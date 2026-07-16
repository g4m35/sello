import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireUser: vi.fn(),
  getActiveAccount: vi.fn(),
  findFirst: vi.fn(),
  markItemSold: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/inventory/mark-sold", () => ({ markItemSold: mocks.markItemSold }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireUser,
}));

import { POST } from "./route";

const TASK_ID = "22222222-2222-4222-8222-222222222222";

function ctx(id: string = TASK_ID) {
  return { params: Promise.resolve({ id }) };
}

function req(body: unknown): Request {
  return new Request(`http://localhost/api/inventory/review-tasks/${TASK_ID}/resolve`, {
    method: "POST",
    headers: { authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/inventory/review-tasks/[id]/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "account-1" });
    mocks.findFirst.mockResolvedValue({
      type: "manual_delist_required",
      inventoryItemId: "item-1",
      marketplace: "ebay",
      payload: {},
    });
    mocks.markItemSold.mockResolvedValue({ outcome: "marked_sold" });
    mocks.getPrisma.mockReturnValue({
      reviewTask: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.requireUser.mockRejectedValue(new AppError("Sign in.", 401));
    const res = await POST(req({ status: "resolved" }), ctx());
    expect(res.status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("resolves a task scoped to the active account and stamps resolvedAt", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(req({ status: "resolved" }), ctx());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true, id: TASK_ID, status: "resolved" });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: TASK_ID, accountId: "account-1", status: "open" },
      select: {
        type: true,
        inventoryItemId: true,
        marketplace: true,
        payload: true,
      },
    });
    const arg = mocks.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: TASK_ID, accountId: "account-1", status: "open" });
    expect(arg.data.status).toBe("resolved");
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
    expect(mocks.markItemSold).not.toHaveBeenCalled();
  });

  it("marks inventory sold when the seller resolves a possible-sale task", async () => {
    mocks.findFirst.mockResolvedValue({
      type: "confirm_possible_sale",
      inventoryItemId: "item-1",
      marketplace: "ebay",
      payload: {
        externalListingId: "listing-external-1",
        marketplaceListingId: "33333333-3333-4333-8333-333333333333",
        price: 24900,
      },
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(req({ status: "resolved" }), ctx());

    expect(res.status).toBe(200);
    expect(mocks.markItemSold).toHaveBeenCalledWith(
      expect.anything(),
      {
        inventoryItemId: "item-1",
        userId: "user-1",
        accountId: "account-1",
        soldMarketplace: "ebay",
        soldListingId: "listing-external-1",
        sourceMarketplaceListingId: "33333333-3333-4333-8333-333333333333",
        soldPriceCents: 24900,
        source: "manual",
      },
    );
  });

  it("re-opens the task when canonical sale confirmation fails", async () => {
    mocks.findFirst.mockResolvedValue({
      type: "confirm_possible_sale",
      inventoryItemId: "item-1",
      marketplace: "ebay",
      payload: {},
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.markItemSold.mockRejectedValue(new AppError("Inventory changed.", 409));

    const res = await POST(req({ status: "resolved" }), ctx());

    expect(res.status).toBe(409);
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany.mock.calls[1][0]).toMatchObject({
      where: { id: TASK_ID, accountId: "account-1", status: "resolved" },
      data: { status: "open", resolvedAt: null },
    });
  });

  it("404s when the task is not owned by the active account", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const res = await POST(req({ status: "dismissed" }), ctx());
    expect(res.status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid status with 400 before any DB work", async () => {
    const res = await POST(req({ status: "archived" }), ctx());
    expect(res.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
