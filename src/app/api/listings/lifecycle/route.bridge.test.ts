import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));

import {
  createInventoryFakePrisma,
  type FakeItem,
  type FakeListing,
} from "@/lib/inventory/test-fake-prisma";

import { POST } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<FakeItem> = {}): FakeItem {
  return {
    id: ITEM_ID,
    sellerId: "user-1",
    accountId: "acc-1",
    productName: "Nike Air Max 1",
    status: "LISTED",
    soldAt: null,
    quantityAvailable: 1,
    soldSourceMarketplace: null,
    soldSourceListingId: null,
    lockVersion: 0,
    ...overrides,
  };
}

function listing(partial: Partial<FakeListing> & { id: string }): FakeListing {
  return {
    inventoryItemId: ITEM_ID,
    marketplace: "grailed",
    status: "LISTED",
    externalListingId: null,
    externalUrl: null,
    titleSnapshot: "Nike Air Max 1",
    endedAt: null,
    ...partial,
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/listings/lifecycle", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

describe("lifecycle mark_sold bridge (double-sell gap closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-1",
      ownerUserId: "user-1",
      plan: "free",
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("queues delist jobs for active listings via the engine and returns { inventoryItem }", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed" }),
        listing({ id: "l-depop", marketplace: "depop" }),
      ],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req({ inventoryItemId: ITEM_ID, action: "mark_sold" }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.inventoryItem.status).toBe("SOLD");
    // Source unknown => null, and EVERY active listing is queued for delist.
    expect(prisma._store.items[0].soldSourceMarketplace).toBeNull();
    expect(prisma._store.syncJobs).toHaveLength(2);
    expect(prisma._store.events.some((e) => e.type === "sale_confirmed")).toBe(true);
  });

  it("is idempotent: a second mark_sold does not duplicate delist jobs", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-grailed", marketplace: "grailed" })],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await POST(req({ inventoryItemId: ITEM_ID, action: "mark_sold" }));
    // After SOLD, canTransition(sold -> sold) is false => 409, the engine is not
    // re-entered, so no duplicate jobs.
    const second = await POST(req({ inventoryItemId: ITEM_ID, action: "mark_sold" }));

    expect(second.status).toBe(409);
    expect(prisma._store.syncJobs).toHaveLength(1);
  });

  it("ownership guard: a different seller cannot mark another's item sold (404)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-grailed", marketplace: "grailed" })],
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireSupabaseUser.mockResolvedValue({ id: "attacker" });
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-2",
      ownerUserId: "attacker",
      plan: "free",
    });

    const res = await POST(req({ inventoryItemId: ITEM_ID, action: "mark_sold" }));

    expect(res.status).toBe(404);
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.syncJobs).toHaveLength(0);
  });

  it("the 'delist' action is unchanged (no engine, plain status flip)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-grailed", marketplace: "grailed" })],
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const res = await POST(req({ inventoryItemId: ITEM_ID, action: "delist" }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.inventoryItem.status).toBe("DELISTED");
    // No delist jobs queued for a plain delist action.
    expect(prisma._store.syncJobs).toHaveLength(0);
  });
});
