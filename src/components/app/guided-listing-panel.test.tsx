import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GuidedListingPanel,
  markAsListedError,
} from "./guided-listing-panel";

const noop = () => undefined;

function render(marketplaces: ("depop" | "grailed" | "mercari")[]) {
  return renderToStaticMarkup(
    <GuidedListingPanel
      token="t"
      itemId="item-1"
      marketplaces={marketplaces}
      photos={[
        { id: "p1", url: "https://cdn.example.com/p1.jpg" },
        { id: "p2", url: null },
      ]}
      onListed={noop}
    />,
  );
}

describe("GuidedListingPanel", () => {
  it("renders nothing when no marketplaces are selected", () => {
    const html = renderToStaticMarkup(
      <GuidedListingPanel
        token="t"
        itemId="item-1"
        marketplaces={[]}
        photos={[]}
        onListed={noop}
      />,
    );
    expect(html).toBe("");
  });

  it("renders one section per marketplace with its sell-form deep link", () => {
    const html = render(["depop", "grailed"]);

    expect(html).toContain('data-marketplace="depop"');
    expect(html).toContain('data-marketplace="grailed"');
    expect(html).toContain('href="https://www.depop.com/products/create"');
    expect(html).toContain('href="https://www.grailed.com/sell/new"');
    expect(html).toContain("Open Depop sell form");
    expect(html).toContain("Open Grailed sell form");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("offers full-text copy and a mark-as-listed control per marketplace", () => {
    const html = render(["mercari"]);

    expect(html).toContain("Copy full listing text");
    expect(html).toContain("Mark as listed");
    // Only real photo URLs are surfaced; the null-url photo is skipped.
    expect(html).toContain('href="https://cdn.example.com/p1.jpg"');
    expect(html).toContain("Photo 1");
    expect(html).not.toContain("Photo 2");
  });
});

describe("markAsListedError", () => {
  it("requires a URL", () => {
    expect(markAsListedError("depop", "")).toBe("Paste the listing URL first.");
    expect(markAsListedError("depop", "   ")).toBe(
      "Paste the listing URL first.",
    );
  });

  it("rejects a URL that is not a plausible listing for the marketplace", () => {
    expect(markAsListedError("depop", "https://www.grailed.com/x")).toBe(
      "That does not look like your Depop listing URL.",
    );
    expect(markAsListedError("grailed", "http://www.grailed.com/x")).toBe(
      "That does not look like your Grailed listing URL.",
    );
  });

  it("accepts a plausible https listing URL on the marketplace host", () => {
    expect(
      markAsListedError("depop", "https://www.depop.com/products/abc-123"),
    ).toBeNull();
    expect(
      markAsListedError("mercari", "https://us.mercari.com/item/m123"),
    ).toBeNull();
  });
});
