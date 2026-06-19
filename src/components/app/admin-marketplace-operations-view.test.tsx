import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AdminMarketplaceOperationsView,
  type FeatureAllowlists,
} from "./admin-marketplace-operations-view";

const ownerAllowlists: FeatureAllowlists = {
  liveEbayPublish: ["owner@sello.com"],
  ebayDelist: ["owner@sello.com"],
  paidComps: ["owner@sello.com"],
};

const emptyAllowlists: FeatureAllowlists = {
  liveEbayPublish: [],
  ebayDelist: [],
  paidComps: [],
};

describe("AdminMarketplaceOperationsView", () => {
  it("does not render a stale '0 allowed' while data is still loading", () => {
    const html = renderToStaticMarkup(
      <AdminMarketplaceOperationsView loaded={false} error={null} access={null} attempts={[]} />,
    );
    expect(html).not.toContain("0 allowed");
    expect(html).toContain("Loading");
  });

  it("renders fetched nonzero counts (not a stale zero) once loaded", () => {
    const html = renderToStaticMarkup(
      <AdminMarketplaceOperationsView
        loaded
        error={null}
        access={ownerAllowlists}
        attempts={[]}
      />,
    );
    // Three allowlists, each with one configured account.
    expect(html.match(/1 allowed/g)).toHaveLength(3);
    expect(html).not.toContain("0 allowed");
    expect(html).toContain("owner@sello.com");
  });

  it("shows a clear zero when an allowlist is genuinely empty", () => {
    const html = renderToStaticMarkup(
      <AdminMarketplaceOperationsView
        loaded
        error={null}
        access={emptyAllowlists}
        attempts={[]}
      />,
    );
    expect(html.match(/0 allowed/g)).toHaveLength(3);
    expect(html).toContain("No accounts allowlisted.");
  });

  it("renders the fetch error instead of stale zeros", () => {
    const html = renderToStaticMarkup(
      <AdminMarketplaceOperationsView
        loaded
        error="Not found."
        access={null}
        attempts={[]}
      />,
    );
    expect(html).toContain("Not found.");
    expect(html).not.toContain("0 allowed");
  });

  it("renders safe attempt fields only", () => {
    const html = renderToStaticMarkup(
      <AdminMarketplaceOperationsView
        loaded
        error={null}
        access={emptyAllowlists}
        attempts={[
          {
            id: "a1",
            requestedBy: "seller-1",
            itemId: "item-1",
            itemTitle: "North Face Nuptse",
            action: "publish",
            status: "SUCCEEDED",
            code: "EBAY_PUBLISH_SUCCEEDED",
            bulkRunId: "bulk-1",
            externalListingId: "1100123",
            createdAt: "2026-06-18T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("North Face Nuptse");
    expect(html).toContain("Publish");
  });
});
