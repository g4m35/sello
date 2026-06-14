import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AttemptView, ChannelStateView } from "@/lib/view/types";

import {
  confirmEbayDelist,
  confirmEbayOrphanCleanup,
  MarketplaceOperationsPanel,
} from "./marketplace-operations-panel";

function channel(overrides: Partial<ChannelStateView> = {}): ChannelStateView {
  return {
    marketplace: "ebay",
    name: "eBay",
    status: "published",
    publishImplemented: false,
    environment: "production",
    sku: "percs_item-1",
    externalOfferId: "offer-1",
    externalListingId: "ebay-listing-1",
    lastError: null,
    ...overrides,
  };
}

function attempt(overrides: Partial<AttemptView> = {}): AttemptView {
  return {
    id: "attempt-1",
    itemId: "item-1",
    itemTitle: "Nike Air Max 1",
    marketplace: "ebay",
    marketplaceName: "eBay",
    environment: "production",
    status: "published",
    rawStatus: "SUCCEEDED",
    listingStatus: "LISTED",
    time: "2026-06-13T12:00:00.000Z",
    createdAt: "2026-06-13T12:00:00.000Z",
    updatedAt: null,
    durationMs: 1200,
    reason: null,
    code: "EBAY_PUBLISH_SUCCEEDED",
    sku: "percs_item-1",
    externalOfferId: "offer-1",
    externalListingId: "ebay-listing-1",
    listingLastError: null,
    failedStep: null,
    ebayErrorStatus: null,
    ebayErrorMessage: null,
    ...overrides,
  };
}

describe("MarketplaceOperationsPanel", () => {
  it("renders publish history and stored eBay identifiers", () => {
    const html = renderToStaticMarkup(
      <MarketplaceOperationsPanel
        channels={[channel()]}
        attempts={[attempt()]}
        onDelistEbay={() => undefined}
        onScanEbayOrphans={() => undefined}
        onCleanupEbayOrphans={() => undefined}
        delisting={false}
        orphanScan={null}
        scanningOrphans={false}
        cleaningOrphans={false}
      />,
    );

    expect(html).toContain("Publish operations");
    expect(html).toContain("Latest attempt");
    expect(html).toContain("Production");
    expect(html).toContain("SKU");
    expect(html).toContain("percs_item-1");
    expect(html).toContain("Offer ID");
    expect(html).toContain("offer-1");
    expect(html).toContain("Listing ID");
    expect(html).toContain("ebay-listing-1");
  });

  it("hides eBay delist when the eBay listing is not published", () => {
    const html = renderToStaticMarkup(
      <MarketplaceOperationsPanel
        channels={[channel({ status: "ready", externalListingId: null })]}
        attempts={[]}
        onDelistEbay={() => undefined}
        onScanEbayOrphans={() => undefined}
        onCleanupEbayOrphans={() => undefined}
        delisting={false}
        orphanScan={null}
        scanningOrphans={false}
        cleaningOrphans={false}
      />,
    );

    expect(html).not.toContain("End eBay listing");
  });

  it("renders last actionable error for a failed attempt", () => {
    const html = renderToStaticMarkup(
      <MarketplaceOperationsPanel
        channels={[channel({ status: "failed", lastError: "Policy missing." })]}
        attempts={[
          attempt({
            status: "failed",
            rawStatus: "FAILED",
            reason: "Policy missing.",
            listingLastError: "Policy missing.",
            failedStep: "Create offer",
            ebayErrorStatus: 400,
            ebayErrorMessage: "Fulfillment policy was not found.",
          }),
        ]}
        onDelistEbay={() => undefined}
        onScanEbayOrphans={() => undefined}
        onCleanupEbayOrphans={() => undefined}
        delisting={false}
        orphanScan={null}
        scanningOrphans={false}
        cleaningOrphans={false}
      />,
    );

    expect(html).toContain("Policy missing.");
    expect(html).toContain("Failed step");
    expect(html).toContain("Create offer");
    expect(html).toContain("eBay status");
    expect(html).toContain("400");
    expect(html).toContain("Fulfillment policy was not found.");
  });

  it("shows orphan scan results and hides cleanup until artifacts exist", () => {
    const html = renderToStaticMarkup(
      <MarketplaceOperationsPanel
        channels={[channel({ status: "failed", externalListingId: null, externalOfferId: null })]}
        attempts={[]}
        onDelistEbay={() => undefined}
        onScanEbayOrphans={() => undefined}
        onCleanupEbayOrphans={() => undefined}
        delisting={false}
        orphanScan={{
          sku: "percs_item-1",
          inventoryItemFound: false,
          offers: [],
          liveListingFound: false,
          cleanupAvailable: false,
          checkedAt: "2026-06-14T12:00:00.000Z",
        }}
        scanningOrphans={false}
        cleaningOrphans={false}
      />,
    );

    expect(html).toContain("Check for eBay orphan publish artifacts");
    expect(html).toContain("percs_item-1");
    expect(html).not.toContain("Clean up unpublished eBay artifacts");
  });

  it("shows guarded cleanup only when an unpublished artifact exists", () => {
    const html = renderToStaticMarkup(
      <MarketplaceOperationsPanel
        channels={[channel({ status: "failed", externalListingId: null, externalOfferId: null })]}
        attempts={[]}
        onDelistEbay={() => undefined}
        onScanEbayOrphans={() => undefined}
        onCleanupEbayOrphans={() => undefined}
        delisting={false}
        orphanScan={{
          sku: "percs_item-1",
          inventoryItemFound: true,
          offers: [
            {
              offerId: "offer-1",
              status: "UNPUBLISHED",
              listingId: null,
              listingStatus: null,
            },
          ],
          liveListingFound: false,
          cleanupAvailable: true,
          checkedAt: "2026-06-14T12:00:00.000Z",
        }}
        scanningOrphans={false}
        cleaningOrphans={false}
      />,
    );

    expect(html).toContain("offer-1");
    expect(html).toContain("Clean up unpublished eBay artifacts");
  });

  it("requires a confirmation that says this ends the live eBay listing", () => {
    const confirm = vi.fn().mockReturnValue(true);

    expect(confirmEbayDelist(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("This ends the live eBay listing"),
    );
  });

  it("requires cleanup confirmation for unpublished orphan artifacts", () => {
    const confirm = vi.fn().mockReturnValue(true);

    expect(confirmEbayOrphanCleanup(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("removes unpublished eBay inventory or offer artifacts"),
    );
  });
});
