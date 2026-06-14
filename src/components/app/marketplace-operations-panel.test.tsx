import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AttemptView, ChannelStateView } from "@/lib/view/types";

import {
  confirmEbayDelist,
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
        delisting={false}
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
        delisting={false}
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
          }),
        ]}
        onDelistEbay={() => undefined}
        delisting={false}
      />,
    );

    expect(html).toContain("Policy missing.");
  });

  it("requires a confirmation that says this ends the live eBay listing", () => {
    const confirm = vi.fn().mockReturnValue(true);

    expect(confirmEbayDelist(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("This ends the live eBay listing"),
    );
  });
});
