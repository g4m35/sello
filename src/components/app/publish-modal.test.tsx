import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ItemView } from "@/lib/view/types";

vi.mock("@/components/providers/session-provider", () => ({
  useSession: () => ({ token: "test-token" }),
}));

const featureMock = vi.hoisted(() => ({
  access: { liveEbayPublish: true, ebayDelist: false, paidComps: false },
  copy: {
    liveEbayPublish:
      "Live eBay publishing is currently enabled for selected alpha accounts.",
    ebayDelist:
      "Live eBay delisting is currently enabled for selected alpha accounts.",
    paidComps: "Fresh sold comps are currently enabled for selected alpha accounts.",
  },
}));

vi.mock("@/components/providers/feature-access-provider", () => ({
  useFeatureAccess: () => ({ loading: false, ...featureMock }),
}));

import { PublishModal } from "./publish-modal";

function item(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: "item-1",
    title: "Nike Air Max 1",
    productName: "Nike Air Max 1",
    brand: "Nike",
    category: "sneakers",
    condition: "new_with_tags",
    size: "US 10",
    colorway: "Aqua",
    priceCents: 24000,
    status: "ready",
    lifecycleState: "ready",
    statusLabel: "Ready",
    ready: true,
    missingCount: 0,
    photoCount: 3,
    updatedAt: "2026-06-13T00:00:00.000Z",
    draftId: "draft-1",
    channels: [
      {
        marketplace: "ebay",
        name: "eBay",
        status: "ready",
        publishImplemented: true,
        environment: "production",
        sku: null,
        externalOfferId: null,
        externalListingId: null,
        lastError: null,
      },
    ],
    ...overrides,
  };
}

describe("PublishModal", () => {
  it("uses explicit live eBay listing confirmation when eBay publish is enabled", () => {
    const html = renderToStaticMarkup(
      <PublishModal open onClose={() => undefined} item={item()} />,
    );

    expect(html).toContain("Final eBay publish review");
    expect(html).toContain("Confirming creates a live eBay listing");
    expect(html).toContain("Create live eBay listing");
  });

  it("renders the preflight-backed final review section for a live eBay publish", () => {
    const html = renderToStaticMarkup(
      <PublishModal open onClose={() => undefined} item={item()} />,
    );

    // The live review is present and, before the dry-run preflight resolves,
    // sits in its loading state (effects do not run in static markup), so the
    // create button is rendered but gated.
    expect(html).toContain("Review the live eBay listing");
    expect(html).toContain("Loading the final eBay review");
    expect(html).toContain("Create live eBay listing");
  });

  it("hides the live review and live publish button when eBay publish is not enabled", () => {
    const draftOnly = item({
      channels: [
        {
          marketplace: "ebay",
          name: "eBay",
          status: "ready",
          publishImplemented: false,
          environment: "production",
          sku: null,
          externalOfferId: null,
          externalListingId: null,
          lastError: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      <PublishModal open onClose={() => undefined} item={draftOnly} />,
    );

    expect(html).not.toContain("Review the live eBay listing");
    expect(html).not.toContain("Create live eBay listing");
    expect(html).toContain("enabled yet");
    expect(html).toContain("Record publish attempt");
  });

  it("uses explicit StockX listing confirmation when StockX publish is enabled", () => {
    const html = renderToStaticMarkup(
      <PublishModal
        open
        onClose={() => undefined}
        item={item({
          channels: [
            {
              marketplace: "stockx",
              name: "StockX",
              status: "ready",
              publishImplemented: true,
              environment: "production",
              sku: null,
              externalOfferId: null,
              externalListingId: null,
              lastError: null,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Final StockX listing review");
    expect(html).toContain("Review the live StockX listing");
    expect(html).toContain("Create live StockX listing");
    expect(html).toContain("I understand this creates a live StockX listing operation");
  });

  it("keeps mixed live eBay and StockX publish copy grouped", () => {
    const html = renderToStaticMarkup(
      <PublishModal
        open
        onClose={() => undefined}
        item={item({
          channels: [
            item().channels[0],
            {
              marketplace: "stockx",
              name: "StockX",
              status: "ready",
              publishImplemented: true,
              environment: "production",
              sku: null,
              externalOfferId: null,
              externalListingId: null,
              lastError: null,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Final live publish review");
    expect(html).toContain("Review the live eBay listing");
    expect(html).toContain("Review the live StockX listing");
    expect(html).toContain("Create live listings");
  });

  it("promotes preview with alpha copy and no live action for non-allowlisted sellers", () => {
    featureMock.access.liveEbayPublish = false;
    try {
      const html = renderToStaticMarkup(
        <PublishModal open onClose={() => undefined} item={item()} />,
      );

      expect(html).toContain(
        "Live eBay publishing is currently enabled for selected alpha accounts.",
      );
      expect(html).not.toContain("Create live eBay listing");
      expect(html).not.toContain("I understand this creates a live eBay listing");
    } finally {
      featureMock.access.liveEbayPublish = true;
    }
  });
});
