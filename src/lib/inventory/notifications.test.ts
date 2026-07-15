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
  const create = async ({ data }: Parameters<NotificationPrismaLike["notification"]["create"]>[0]) => {
    const id = `notif-${notifications.length + 1}`;
    notifications.push({ id, ...data });
    return { id };
  };
  return {
    _notifications: notifications,
    notification: {
      create,
      async upsert({ where, create: data }) {
        const key = where.accountId_dedupeKey;
        const existing = notifications.find(
          (notification) =>
            notification.accountId === key.accountId &&
            notification.dedupeKey === key.dedupeKey,
        );
        if (existing) return { id: String(existing.id) };
        return create({ data });
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
      accountId: "account-1",
      kind: "sold_delisting",
      title: "t",
      body: "b",
      inventoryItemId: "item-1",
    });
  });

  it("dedupes the same key inside one account", async () => {
    const prisma = createFakePrisma();
    const input = {
      userId: "user-1",
      accountId: "account-1",
      kind: "sync_conflict",
      title: "Conflict",
      body: "Review it.",
      dedupeKey: "conflict:item-1",
    };

    const first = await createNotification(prisma, input);
    const second = await createNotification(prisma, input);

    expect(second.id).toBe(first.id);
    expect(prisma._notifications).toHaveLength(1);
  });

  it("allows the same dedupe key in separate accounts", async () => {
    const prisma = createFakePrisma();
    const shared = {
      kind: "sync_conflict",
      title: "Conflict",
      body: "Review it.",
      dedupeKey: "conflict:item-1",
    };

    await createNotification(prisma, {
      ...shared,
      userId: "user-1",
      accountId: "account-1",
    });
    await createNotification(prisma, {
      ...shared,
      userId: "user-2",
      accountId: "account-2",
    });

    expect(prisma._notifications).toHaveLength(2);
    expect(prisma._notifications.map((notification) => notification.accountId)).toEqual([
      "account-1",
      "account-2",
    ]);
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
