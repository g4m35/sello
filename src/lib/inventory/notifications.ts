import type { Marketplace } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

// In-app notification feed for safety events. The copy builders below are the
// single source of seller-facing wording so mark-sold / sale-signal / the delist
// flow stay consistent and never embed raw provider text. `kind` is a stable
// machine string (used for grouping/badging); title/body are human copy.

export type NotificationPrismaLike = {
  notification: {
    create(args: {
      data: {
        userId: string;
        accountId?: string | null;
        kind: string;
        title: string;
        body: string;
        inventoryItemId?: string | null;
        dedupeKey?: string | null;
      };
    }): Promise<{ id: string }>;
  };
};

export const NotificationKind = {
  soldDelisting: "sold_delisting",
  possibleSaleConfirm: "possible_sale_confirm",
  manualDelistRequired: "manual_delist_required",
  delistFailed: "delist_failed",
  syncConflict: "sync_conflict",
} as const;

export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  ebay: "eBay",
  grailed: "Grailed",
  poshmark: "Poshmark",
  depop: "Depop",
  etsy: "Etsy",
  tiktok_shop: "TikTok Shop",
  vinted: "Vinted",
  stockx: "StockX",
};

export function marketplaceLabel(marketplace: Marketplace): string {
  return MARKETPLACE_LABELS[marketplace];
}

export type NotificationCopy = { kind: NotificationKind; title: string; body: string };

// --- Seller-friendly copy builders -------------------------------------------

export function soldDelistingCopy(input: {
  productName: string;
  // null = "source unknown" (e.g. a manual mark-sold with no named marketplace).
  soldMarketplace: Marketplace | null;
  // How many OTHER listings we can remove automatically (eBay; adapter-available).
  autoDelistCount: number;
  // How many OTHER listings need the seller to remove them by hand (no adapter).
  manualDelistCount: number;
}): NotificationCopy {
  const where = input.soldMarketplace
    ? marketplaceLabel(input.soldMarketplace)
    : null;
  const soldClause = where ? `sold on ${where}` : "sold";
  const auto = input.autoDelistCount;
  const manual = input.manualDelistCount;

  // Only ever claim automatic removal for listings we can actually auto-delist.
  const autoClause =
    auto > 0
      ? ` We're removing it from your ${auto} other listing${auto === 1 ? "" : "s"} so it can't sell twice.`
      : "";
  const manualClause =
    manual > 0
      ? ` ${manual} other listing${manual === 1 ? "" : "s"} need${manual === 1 ? "s" : ""} a manual delist — please remove ${manual === 1 ? "it" : "them"} so it can't sell twice.`
      : "";
  const noneClause =
    auto === 0 && manual === 0 ? " No other live listings to remove." : "";

  return {
    kind: NotificationKind.soldDelisting,
    title: where
      ? `Sold on ${where} — cleaning up your other listings`
      : `Sold — cleaning up your other listings`,
    body: `Your ${input.productName} ${soldClause}.${autoClause}${manualClause}${noneClause}`,
  };
}

export function possibleSaleConfirmCopy(input: {
  productName: string;
  marketplace: Marketplace;
}): NotificationCopy {
  const where = marketplaceLabel(input.marketplace);
  return {
    kind: NotificationKind.possibleSaleConfirm,
    title: `Did your ${input.productName} sell on ${where}?`,
    body: `We saw a possible sale of your ${input.productName} on ${where}, but we're not sure enough to remove your other listings automatically. Confirm it so we can take it down everywhere else.`,
  };
}

export function manualDelistRequiredCopy(input: {
  productName: string;
  marketplace: Marketplace;
}): NotificationCopy {
  const where = marketplaceLabel(input.marketplace);
  return {
    kind: NotificationKind.manualDelistRequired,
    title: `Remove your ${input.productName} from ${where}`,
    body: `Your ${input.productName} sold elsewhere. We can't remove the ${where} listing for you, so please take it down manually to avoid selling it twice.`,
  };
}

export function delistFailedCopy(input: {
  productName: string;
  marketplace: Marketplace;
}): NotificationCopy {
  const where = marketplaceLabel(input.marketplace);
  return {
    kind: NotificationKind.delistFailed,
    title: `Couldn't remove your ${input.productName} from ${where}`,
    body: `We tried to take down your ${input.productName} on ${where} after it sold, but it didn't go through. Please remove it manually so it can't sell twice. We'll keep retrying.`,
  };
}

export function syncConflictCopy(input: {
  productName: string;
  alreadySoldMarketplace: Marketplace;
  conflictingMarketplace: Marketplace;
}): NotificationCopy {
  const already = marketplaceLabel(input.alreadySoldMarketplace);
  const conflicting = marketplaceLabel(input.conflictingMarketplace);
  return {
    kind: NotificationKind.syncConflict,
    title: `Conflicting sale for your ${input.productName}`,
    body: `Your ${input.productName} is already marked sold on ${already}, but we just saw a sale signal from ${conflicting}. Please review which sale is real so we don't act on the wrong one.`,
  };
}

// --- Persistence -------------------------------------------------------------

export type CreateNotificationInput = {
  userId: string;
  accountId?: string | null;
  kind: string;
  title: string;
  body: string;
  inventoryItemId?: string | null;
  dedupeKey?: string | null;
};

export async function createNotification(
  db: NotificationPrismaLike = getPrisma(),
  input: CreateNotificationInput,
): Promise<{ id: string }> {
  return db.notification.create({
    data: {
      userId: input.userId,
      accountId: input.accountId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      inventoryItemId: input.inventoryItemId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    },
  });
}
