import { describe, expect, it } from "vitest";

import type { FeatureAccess } from "@/lib/auth/feature-access";
import type { ChannelStateView } from "@/lib/view/types";

import {
  ebayChannelUrl,
  ebayListingUrl,
  isLiveMarketplaceStatus,
  partitionDeletable,
  resolveDelistAction,
  resolvePublishAction,
  resolveRemoveAction,
} from "./inventory-actions";

function access(over: Partial<FeatureAccess> = {}): FeatureAccess {
  return { liveEbayPublish: false, ebayDelist: false, paidComps: false, ...over };
}

function channel(over: Partial<ChannelStateView> = {}): ChannelStateView {
  return {
    marketplace: "ebay",
    name: "eBay",
    status: "published",
    publishImplemented: true,
    environment: "production",
    sku: "percs_item-1",
    externalOfferId: "offer-1",
    externalListingId: "ebay-listing-1",
    lastError: null,
    ...over,
  };
}

describe("resolvePublishAction", () => {
  it("promotes a live publish with explicit confirmation for allowlisted sellers", () => {
    const action = resolvePublishAction(access({ liveEbayPublish: true }));
    expect(action.mode).toBe("publish_live");
    expect(action.label).toBe("Publish to eBay");
    expect(action.restricted).toBe(false);
  });

  it("promotes preview only for non-allowlisted sellers", () => {
    const action = resolvePublishAction(access());
    expect(action.mode).toBe("preview");
    expect(action.label).toBe("Preview eBay listing");
    expect(action.restricted).toBe(true);
    expect(action.entitlement).toBe("liveEbayPublish");
  });
});

describe("resolveDelistAction", () => {
  it("offers End eBay listing only when delist-entitled and a live listing exists", () => {
    const action = resolveDelistAction(channel(), access({ ebayDelist: true }));
    expect(action.available).toBe(true);
    expect(action.label).toBe("End eBay listing");
  });

  it("is restricted with alpha copy when a live listing exists but the seller is not entitled", () => {
    const action = resolveDelistAction(channel(), access());
    expect(action.available).toBe(false);
    expect(action.restricted).toBe(true);
    expect(action.entitlement).toBe("ebayDelist");
  });

  it("is unavailable and not restricted when there is no live listing", () => {
    const action = resolveDelistAction(channel({ status: "ready", externalListingId: null }), access({ ebayDelist: true }));
    expect(action.available).toBe(false);
    expect(action.restricted).toBe(false);
  });
});

describe("eBay listing url", () => {
  it("builds the public itm url from an external listing id", () => {
    expect(ebayListingUrl("123456789")).toBe("https://www.ebay.com/itm/123456789");
  });

  it("returns null without a listing id", () => {
    expect(ebayListingUrl(null)).toBeNull();
  });

  it("only resolves a channel url for a published listing", () => {
    expect(ebayChannelUrl(channel())).toBe("https://www.ebay.com/itm/ebay-listing-1");
    expect(ebayChannelUrl(channel({ status: "ready" }))).toBeNull();
    expect(ebayChannelUrl(channel({ externalListingId: null }))).toBeNull();
    expect(ebayChannelUrl(null)).toBeNull();
  });
});

describe("resolveRemoveAction", () => {
  it("archives live/sold items and deletes drafts", () => {
    expect(resolveRemoveAction({ lifecycleState: "active" })).toMatchObject({ kind: "archive", label: "Archive listing" });
    expect(resolveRemoveAction({ lifecycleState: "sold" })).toMatchObject({ kind: "archive" });
    expect(resolveRemoveAction({ lifecycleState: "draft" })).toMatchObject({ kind: "delete", label: "Delete draft" });
    expect(resolveRemoveAction({ lifecycleState: "ready" })).toMatchObject({ kind: "delete" });
  });
});

describe("partitionDeletable", () => {
  it("flags live/in-flight marketplace statuses as live", () => {
    expect(isLiveMarketplaceStatus("LISTED")).toBe(true);
    expect(isLiveMarketplaceStatus("LISTING")).toBe(true);
    expect(isLiveMarketplaceStatus("DELISTING")).toBe(true);
    expect(isLiveMarketplaceStatus("DELISTED")).toBe(false);
    expect(isLiveMarketplaceStatus("NOT_LISTED")).toBe(false);
  });

  it("partitions safe drafts from items with live artifacts independently", () => {
    const { deletable, blocked } = partitionDeletable([
      { itemId: "a", statuses: ["NOT_LISTED"] },
      { itemId: "b", statuses: ["LISTED"] },
      { itemId: "c", statuses: [] },
      { itemId: "d", statuses: ["DELISTED", "DELISTING"] },
    ]);
    expect(deletable).toEqual(["a", "c"]);
    expect(blocked).toEqual([
      { itemId: "b", reason: "LIVE_MARKETPLACE_LISTING" },
      { itemId: "d", reason: "LIVE_MARKETPLACE_LISTING" },
    ]);
  });
});
