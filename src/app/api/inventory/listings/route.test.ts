import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireUser: vi.fn(),
  getActiveAccount: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireUser,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function req(body: unknown): Request {
  return new Request("http://localhost/api/inventory/listings", {
    method: "POST",
    headers: { authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  inventoryItemId: ITEM_ID,
  marketplace: "depop",
  externalUrl: "https://www.depop.com/products/seller-item/",
};

describe("POST /api/inventory/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.getPrisma.mockReturnValue({
      inventoryItem: { findFirst: mocks.findFirst },
      marketplaceListing: { upsert: mocks.upsert },
      inventoryEvent: { create: mocks.eventCreate },
    });
    mocks.eventCreate.mockResolvedValue({ id: "event-1" });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.requireUser.mockRejectedValue(new AppError("Sign in.", 401));
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("404s and never upserts when the item is not owned by the seller", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: ITEM_ID, accountId: "acc-1" },
      select: { id: true, accountId: true },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("upserts the listing (env=production, default UNKNOWN) and records listing_created", async () => {
    mocks.findFirst.mockResolvedValue({ id: ITEM_ID, accountId: "acc-1" });
    mocks.upsert.mockResolvedValue({
      id: "ml-1",
      status: "UNKNOWN",
      externalUrl: validBody.externalUrl,
    });

    const res = await POST(req(validBody));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.listing.id).toBe("ml-1");

    const upsertArg = mocks.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      inventoryItemId_marketplace_environment: {
        inventoryItemId: ITEM_ID,
        marketplace: "depop",
        environment: "production",
      },
    });
    expect(upsertArg.create.status).toBe("UNKNOWN");
    expect(upsertArg.create.environment).toBe("production");
    expect(upsertArg.create.externalUrl).toBe(validBody.externalUrl);

    expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
    const eventData = mocks.eventCreate.mock.calls[0][0].data;
    expect(eventData).toMatchObject({
      inventoryItemId: ITEM_ID,
      userId: "user-1",
      accountId: "acc-1",
      type: "listing_created",
      source: "manual",
      marketplace: "depop",
    });
  });

  it("honors an explicit status when provided", async () => {
    mocks.findFirst.mockResolvedValue({ id: ITEM_ID, accountId: "acc-1" });
    mocks.upsert.mockResolvedValue({ id: "ml-1", status: "LISTED", externalUrl: validBody.externalUrl });

    await POST(req({ ...validBody, status: "LISTED" }));
    expect(mocks.upsert.mock.calls[0][0].create.status).toBe("LISTED");
  });

  it("rejects a non-url externalUrl with 400 before any DB work", async () => {
    const res = await POST(req({ ...validBody, externalUrl: "not-a-url" }));
    expect(res.status).toBe(400);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
