import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireUser: vi.fn(),
  getActiveAccount: vi.fn(),
  findFirst: vi.fn(),
  markItemSold: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
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
    const tx = { reviewTask: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } };
    mocks.transaction.mockImplementation(async (work) => work(tx));
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });
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

  it("rolls back the enclosing transaction when canonical sale confirmation fails", async () => {
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
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("Inventory changed.");
  });

  it("does not mark sold if another decision wins the conditional task claim", async () => {
    mocks.findFirst.mockResolvedValue({ type: "confirm_possible_sale", inventoryItemId: "item-1", marketplace: "ebay", payload: {} });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(req({ status: "resolved" }), ctx());
    expect(res.status).toBe(404);
    expect(mocks.markItemSold).not.toHaveBeenCalled();
  });

  it("rejects missing sale details without committing the task claim", async () => {
    mocks.findFirst.mockResolvedValue({ type: "confirm_possible_sale", inventoryItemId: null, marketplace: "ebay", payload: {} });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const res = await POST(req({ status: "resolved" }), ctx());
    expect(res.status).toBe(409);
    expect(mocks.markItemSold).not.toHaveBeenCalled();
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("missing required listing details");
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


describe("atomic possible-sale resolution", () => {
  type State = { taskStatus: string; sold: boolean; delistJobs: number };
  const task = { type: "confirm_possible_sale", inventoryItemId: "item-1", marketplace: "ebay", payload: {} };
  let state: State;
  let failBeforeCommit: boolean;
  let saleFailure: boolean;
  let claims: string[];
  beforeEach(() => {
    vi.clearAllMocks();
    state = { taskStatus: "open", sold: false, delistJobs: 0 };
    claims = []; failBeforeCommit = false; saleFailure = false;
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "account-1" });
    // Model commit/rollback and a transaction lock. The root client's model
    // delegates intentionally do not exist, so escaping the transaction fails.
    let lock = Promise.resolve();
    const transaction = async (work: (tx: unknown) => Promise<unknown>) => {
      const previous = lock;
      let unlock!: () => void;
      lock = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      const pending = { ...state };
      const tx = {
        reviewTask: {
          findFirst: async ({ where }: { where: { id: string; accountId: string; status: string } }) => {
            expect(where).toEqual({ id: TASK_ID, accountId: "account-1", status: "open" });
            return pending.taskStatus === "open" ? task : null;
          },
          updateMany: async ({ where, data }: { where: { accountId: string; status: string }; data: { status: string } }) => {
            expect(where.accountId).toBe("account-1");
            if (pending.taskStatus !== where.status) return { count: 0 };
            pending.taskStatus = data.status; claims.push(data.status); return { count: 1 };
          },
        },
        inventoryItem: { update: async () => { pending.sold = true; } },
        syncJob: { create: async () => { pending.delistJobs++; } },
      };
      try {
        const result = await work(tx);
        if (failBeforeCommit) throw new Error("Interrupted before commit");
        state = pending;
        return result;
      } finally { unlock(); }
    };
    mocks.getPrisma.mockReturnValue({ $transaction: transaction });
    mocks.markItemSold.mockImplementation(async (db, input) => {
      expect(input.accountId).toBe("account-1");
      await db.$transaction(async (tx: typeof db) => {
        await tx.inventoryItem.update();
        if (saleFailure) throw new AppError("Delist queue failed.", 409);
        await tx.syncJob.create();
      });
      return { outcome: "marked_sold" };
    });
  });

  it("commits the resolution, sold state and delist work together", async () => {
    expect((await POST(req({ status: "resolved" }), ctx())).status).toBe(200);
    expect(state).toEqual({ taskStatus: "resolved", sold: true, delistJobs: 1 });
  });
  it("keeps the task open and inventory unchanged when delist preparation fails", async () => {
    saleFailure = true;
    expect((await POST(req({ status: "resolved" }), ctx())).status).toBe(409);
    expect(state).toEqual({ taskStatus: "open", sold: false, delistJobs: 0 });
  });
  it("rolls back an interruption after all writes but before commit and permits a safe retry", async () => {
    failBeforeCommit = true;
    expect((await POST(req({ status: "resolved" }), ctx())).status).toBe(500);
    expect(state).toEqual({ taskStatus: "open", sold: false, delistJobs: 0 });
    failBeforeCommit = false;
    expect((await POST(req({ status: "resolved" }), ctx())).status).toBe(200);
    expect(state).toEqual({ taskStatus: "resolved", sold: true, delistJobs: 1 });
  });
  it("allows only one of two concurrent confirmations to mark sold", async () => {
    const results = await Promise.all([POST(req({ status: "resolved" }), ctx()), POST(req({ status: "resolved" }), ctx())]);
    expect(results.map((result) => result.status)).toEqual([200, 404]);
    expect(mocks.markItemSold).toHaveBeenCalledOnce();
    expect(state.delistJobs).toBe(1);
  });
  it.each(["resolved", "dismissed"])("serializes a %s winner against a conflicting decision", async (winner) => {
    const loser = winner === "resolved" ? "dismissed" : "resolved";
    const results = await Promise.all([POST(req({ status: winner }), ctx()), POST(req({ status: loser }), ctx())]);
    expect(results.map((result) => result.status)).toEqual([200, 404]);
    expect(claims).toEqual([winner]);
    expect(state).toEqual({ taskStatus: winner, sold: winner === "resolved", delistJobs: winner === "resolved" ? 1 : 0 });
  });
});
