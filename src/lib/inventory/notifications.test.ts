import { describe, expect, it } from "vitest";

import {
  createNotification,
  delistFailedCopy,
  manualDelistRequiredCopy,
  NotificationKind,
  possibleSaleConfirmCopy,
  soldDelistingCopy,
  syncConflictCopy,
  type NotificationPrismaLike,
} from "./notifications";

function createFakePrisma(): NotificationPrismaLike & {
  _notifications: Array<Record<string, unknown>>;
} {
  const notifications: Array<Record<string, unknown>> = [];
  return {
    _notifications: notifications,
    notification: {
      async create({ data }) {
        notifications.push(data as Record<string, unknown>);
        return { id: `notif-${notifications.length}` };
      },
    },
  };
}

describe("createNotification", () => {
  it("persists the notification with the given fields", async () => {
    const prisma = createFakePrisma();

    await createNotification(prisma, {
      userId: "user-1",
      kind: "sold_delisting",
      title: "t",
      body: "b",
      inventoryItemId: "item-1",
    });

    expect(prisma._notifications[0]).toMatchObject({
      userId: "user-1",
      kind: "sold_delisting",
      title: "t",
      body: "b",
      inventoryItemId: "item-1",
    });
  });
});

describe("copy builders", () => {
  it("sold+delisting copy names the marketplace and other-listing count", () => {
    const copy = soldDelistingCopy({
      productName: "Air Max 1",
      soldMarketplace: "ebay",
      otherMarketplaceCount: 2,
    });
    expect(copy.kind).toBe(NotificationKind.soldDelisting);
    expect(copy.title).toContain("eBay");
    expect(copy.body).toContain("Air Max 1");
    expect(copy.body).toContain("2 other listings");
  });

  it("sold+delisting copy handles a single other listing and zero others", () => {
    expect(
      soldDelistingCopy({
        productName: "X",
        soldMarketplace: "depop",
        otherMarketplaceCount: 1,
      }).body,
    ).toContain("1 other listing");
    expect(
      soldDelistingCopy({
        productName: "X",
        soldMarketplace: "depop",
        otherMarketplaceCount: 0,
      }).body,
    ).toContain("No other live listings");
  });

  it("possible-sale-confirm copy asks the seller to confirm", () => {
    const copy = possibleSaleConfirmCopy({ productName: "X", marketplace: "poshmark" });
    expect(copy.kind).toBe(NotificationKind.possibleSaleConfirm);
    expect(copy.title).toContain("Poshmark");
    expect(copy.body.toLowerCase()).toContain("confirm");
  });

  it("manual-delist-required copy tells the seller to take it down manually", () => {
    const copy = manualDelistRequiredCopy({ productName: "X", marketplace: "grailed" });
    expect(copy.kind).toBe(NotificationKind.manualDelistRequired);
    expect(copy.body.toLowerCase()).toContain("manually");
  });

  it("delist-failed copy explains the retry/manual fallback", () => {
    const copy = delistFailedCopy({ productName: "X", marketplace: "etsy" });
    expect(copy.kind).toBe(NotificationKind.delistFailed);
    expect(copy.body.toLowerCase()).toContain("manually");
  });

  it("sync-conflict copy names both marketplaces", () => {
    const copy = syncConflictCopy({
      productName: "X",
      alreadySoldMarketplace: "ebay",
      conflictingMarketplace: "grailed",
    });
    expect(copy.kind).toBe(NotificationKind.syncConflict);
    expect(copy.body).toContain("eBay");
    expect(copy.body).toContain("Grailed");
  });
});
