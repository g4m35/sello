import { describe, expect, it, vi } from "vitest";
import type { InventoryStatus } from "@/generated/prisma/client";
import {
  syncMasterStatusAfterMarketplaceCleanup,
  syncMasterStatusAfterMarketplaceDelist,
  syncMasterStatusAfterMarketplacePublish,
  type MarketplaceLifecycleSyncPrismaLike,
} from "./lifecycle-sync";

// Model Prisma's conditional UPDATE: eligibility is checked when the write
// executes, after the remote marketplace action and any concurrent sale.
function fixture(initial: { status: InventoryStatus; soldAt: Date | null; soldSourceMarketplace: string | null }, channels = ["DELISTED"]) {
  const item = { ...initial };
  let beforeWrite = () => {};
  const db: MarketplaceLifecycleSyncPrismaLike = {
    inventoryItem: {
      update: vi.fn(async ({ where, data }) => {
        beforeWrite();
        if (item.status === where.status.not || item.soldAt !== where.soldAt || item.soldSourceMarketplace !== where.soldSourceMarketplace) {
          throw Object.assign(new Error("No eligible item"), { code: "P2025" });
        }
        item.status = data.status;
        return item;
      }),
    },
    marketplaceListing: { findMany: vi.fn(async () => channels.map(status => ({ status }))) },
  };
  return { db, item, race: (fn: () => void) => { beforeWrite = fn; } };
}

const unsold = { status: "LISTED" as const, soldAt: null, soldSourceMarketplace: null };
const operations = [
  { name: "publish completion", run: syncMasterStatusAfterMarketplacePublish },
  { name: "delist completion", run: syncMasterStatusAfterMarketplaceDelist },
  { name: "orphan cleanup", run: syncMasterStatusAfterMarketplaceCleanup },
];

describe.each(operations)("$name preserves sold inventory", ({ run }) => {
  it.each([null, "ebay"])("preserves a confirmed sale with source %s", async (source) => {
    const { db, item } = fixture({ status: "SOLD", soldAt: new Date(), soldSourceMarketplace: source });
    await run(db, "item-1");
    expect(item.status).toBe("SOLD");
  });

  it("preserves SOLD even when an older record lacks sale metadata", async () => {
    const f = fixture({ status: "SOLD", soldAt: null, soldSourceMarketplace: null });
    await run(f.db, "item-1");
    expect(f.item.status).toBe("SOLD");
  });

  it("preserves durable source evidence even when soldAt and status are stale", async () => {
    const f = fixture({ status: "DELISTED", soldAt: null, soldSourceMarketplace: "ebay" }, ["LISTED"]);
    await run(f.db, "item-1");
    expect(f.item.status).toBe("DELISTED");
  });

  it("does not overwrite a sale committed after the marketplace result was read", async () => {
    const f = fixture(unsold, ["LISTED"]);
    f.race(() => { f.item.status = "SOLD"; f.item.soldAt = new Date(); });
    await run(f.db, "item-1");
    expect(f.item.status).toBe("SOLD");
  });

  it("does not trust a stale display status over durable sale evidence", async () => {
    const f = fixture({ status: "DELISTED", soldAt: new Date(), soldSourceMarketplace: null }, ["LISTED"]);
    await run(f.db, "item-1");
    expect(f.item.status).toBe("DELISTED");
  });

  it("propagates database failures instead of treating them as a completed projection", async () => {
    const f = fixture(unsold);
    vi.mocked(f.db.inventoryItem.update).mockRejectedValue(new Error("Database unavailable"));
    await expect(run(f.db, "item-1")).rejects.toThrow("Database unavailable");
  });
});

it("normal delisting keeps an unsold item listed when another channel is active", async () => {
  const f = fixture(unsold, ["DELISTED", "LISTED"]);
  await syncMasterStatusAfterMarketplaceDelist(f.db, "item-1");
  expect(f.item.status).toBe("LISTED");
});

it("normal delisting ends unsold inventory when no channel is active", async () => {
  const f = fixture(unsold);
  await syncMasterStatusAfterMarketplaceDelist(f.db, "item-1");
  expect(f.item.status).toBe("DELISTED");
});
