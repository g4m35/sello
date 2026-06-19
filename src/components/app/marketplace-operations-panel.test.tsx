import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AttemptView, ChannelStateView } from "@/lib/view/types";

import {
  MarketplaceOperationsPanel,
  sellerPublishStatus,
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
    bulkRunId: null,
    ...overrides,
  };
}

function render(props: Partial<React.ComponentProps<typeof MarketplaceOperationsPanel>> = {}) {
  return renderToStaticMarkup(
    <MarketplaceOperationsPanel
      channels={props.channels ?? [channel()]}
      attempts={props.attempts ?? [attempt()]}
      onDelistEbay={() => undefined}
      onScanEbayOrphans={() => undefined}
      onCleanupEbayOrphans={() => undefined}
      delisting={false}
      orphanScan={props.orphanScan ?? null}
      scanningOrphans={false}
      cleaningOrphans={false}
      showAdvanced={props.showAdvanced}
    />,
  );
}

describe("sellerPublishStatus", () => {
  it("describes a ready item with production publishing disabled", () => {
    const status = sellerPublishStatus(channel({ status: "ready", publishImplemented: false }));
    expect(status.label).toBe("Publish disabled");
    expect(status.meaning).toMatch(/production publishing is currently disabled/i);
  });

  it("describes a ready item that can publish", () => {
    const status = sellerPublishStatus(channel({ status: "ready", publishImplemented: true }));
    expect(status.label).toBe("Ready to publish");
  });

  it("describes a published, failed, and draft item", () => {
    expect(sellerPublishStatus(channel({ status: "published" })).label).toBe("Published");
    expect(sellerPublishStatus(channel({ status: "failed" })).label).toBe("Error");
    expect(sellerPublishStatus(channel({ status: "draft" })).label).toBe("Draft only");
  });
});

describe("MarketplaceOperationsPanel (seller view)", () => {
  it("shows a plain-language eBay status and hides technical identifiers by default", () => {
    const html = render({ channels: [channel({ status: "published" })], attempts: [attempt()] });
    expect(html).toContain("Published");
    expect(html).toMatch(/live on eBay/i);
    // No developer language for normal sellers.
    expect(html).not.toContain("SKU");
    expect(html).not.toContain("Offer ID");
    expect(html).not.toContain("Listing ID");
    expect(html).not.toContain("percs_item-1");
    expect(html).not.toContain("offer-1");
    expect(html).not.toMatch(/orphan/i);
  });

  it("explains a ready item when production publishing is disabled", () => {
    const html = render({
      channels: [channel({ status: "ready", publishImplemented: false })],
      attempts: [],
    });
    expect(html).toContain("Publish disabled");
    expect(html).toMatch(/production publishing is currently disabled/i);
  });

  it("shows an Error status without leaking the raw provider error by default", () => {
    const html = render({
      channels: [channel({ status: "failed", lastError: "Policy missing." })],
      attempts: [
        attempt({
          status: "failed",
          rawStatus: "FAILED",
          reason: "Policy missing.",
          listingLastError: "Policy missing.",
          failedStep: "Create offer",
          ebayErrorStatus: 400,
          ebayErrorMessage: "Fulfillment policy was not found.",
        }),
      ],
    });
    expect(html).toContain("Error");
    expect(html).not.toContain("Fulfillment policy was not found.");
    expect(html).not.toContain("Failed step");
  });

  it("reveals technical details only under advanced diagnostics", () => {
    const html = render({
      channels: [channel({ status: "published" })],
      attempts: [attempt()],
      showAdvanced: true,
    });
    expect(html).toMatch(/Advanced eBay diagnostics/i);
    expect(html).toContain("SKU");
    expect(html).toContain("percs_item-1");
    expect(html).toContain("Offer ID");
    expect(html).toContain("offer-1");
    expect(html).toContain("Listing ID");
    expect(html).toContain("ebay-listing-1");
  });

  it("shows orphan recovery and raw errors only in advanced diagnostics", () => {
    const failed = {
      channels: [channel({ status: "failed", externalListingId: null, externalOfferId: null, lastError: "Policy missing." })],
      attempts: [
        attempt({
          status: "failed",
          rawStatus: "FAILED",
          reason: "Policy missing.",
          failedStep: "Create offer",
          ebayErrorMessage: "Fulfillment policy was not found.",
          externalOfferId: null,
          externalListingId: null,
        }),
      ],
      orphanScan: {
        sku: "percs_item-1",
        inventoryItemFound: true,
        offers: [{ offerId: "offer-1", status: "UNPUBLISHED", listingId: null, listingStatus: null }],
        liveListingFound: false,
        cleanupAvailable: true,
        checkedAt: "2026-06-14T12:00:00.000Z",
      },
    };
    const plain = render(failed);
    expect(plain).not.toMatch(/orphan/i);

    const advanced = render({ ...failed, showAdvanced: true });
    expect(advanced).toMatch(/orphan/i);
    expect(advanced).toContain("Clean up unpublished eBay artifacts");
    expect(advanced).toContain("Fulfillment policy was not found.");
  });

  it("keeps the End eBay listing action visible for a live listing", () => {
    const html = render({
      channels: [channel({ status: "published" })],
      attempts: [attempt()],
    });
    expect(html).toContain("End eBay listing");
  });

  it("hides End eBay listing when stored live identifiers are missing", () => {
    const html = render({
      channels: [channel({ status: "published", externalListingId: null })],
      attempts: [],
    });
    expect(html).not.toContain("End eBay listing");
  });

  it("never renders a raw 'Live' badge", () => {
    expect(render()).not.toContain(">Live<");
    expect(render({ channels: [], attempts: [] })).not.toContain(">Live<");
  });
});
