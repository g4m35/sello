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
      accountId: "account-1",
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
  it("sold+delisting copy names the marketplace and the auto-removed count", () => {
    const copy = soldDelistingCopy({
      productName: "Air Max 1",
      soldMarketplace: "ebay",
      autoDelistCount: 2,
      manualDelistCount: 0,
    });
    expect(copy.kind).toBe(NotificationKind.soldDelisting);
    expect(copy.title).toContain("eBay");
    expect(copy.body).toContain("Air Max 1");
    expect(copy.body).toContain("removing it from your 2 other listings");
  });

  it("sold+delisting copy handles a single auto-removed listing and zero others", () => {
    expect(
      soldDelistingCopy({
        productName: "X",
        soldMarketplace: "depop",
        autoDelistCount: 1,
        manualDelistCount: 0,
      }).body,
    ).toContain("removing it from your 1 other listing");
    expect(
      soldDelistingCopy({
        productName: "X",
        soldMarketplace: "depop",
        autoDelistCount: 0,
        manualDelistCount: 0,
      }).body,
    ).toContain("No other live listings");
  });

  it("sold+delisting copy does NOT claim automatic removal when only manual delists exist", () => {
    const copy = soldDelistingCopy({
      productName: "X",
      soldMarketplace: "depop",
      autoDelistCount: 0,
      manualDelistCount: 1,
    });
    // No false "we're removing it" automation claim.
    expect(copy.body).not.toContain("We're removing it");
    expect(copy.body.toLowerCase()).toContain("manual delist");
    expect(copy.body).toContain("1 other listing");
  });

  it("sold+delisting copy reports both an auto removal AND a manual delist", () => {
    const copy = soldDelistingCopy({
      productName: "X",
      soldMarketplace: "grailed",
      autoDelistCount: 1,
      manualDelistCount: 2,
    });
    expect(copy.body).toContain("removing it from your 1 other listing");
    expect(copy.body).toContain("2 other listings need");
    expect(copy.body.toLowerCase()).toContain("manual delist");
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
