import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CompsTable,
  PricingRecommendationCard,
  type CompRow,
  type Summary,
} from "./comps-pricing-view";

function readySummary(overrides: Partial<Summary> = {}): Summary {
  return {
    status: "ready",
    totalComps: 4,
    validComps: 4,
    compCount: 4,
    soldCompCount: 3,
    activeCompCount: 1,
    lowCents: 18000,
    medianCents: 20000,
    averageCents: 21000,
    highCents: 26000,
    quickSaleCents: 18000,
    recommendedListCents: 22000,
    confidence: "medium",
    confidenceScore: 0.55,
    confidenceReasons: ["Anchored on 3 sold comps.", "Consistent brand across comps."],
    ...overrides,
  };
}

function row(overrides: Partial<CompRow> = {}): CompRow {
  return {
    id: "comp-1",
    source: "StockX",
    platform: "stockx",
    status: "sold",
    title: "Air Jordan 1",
    brand: "Nike",
    size: "10",
    priceCents: 20000,
    shippingCents: 0,
    totalPriceCents: null,
    soldDate: null,
    url: null,
    condition: "used_good",
    usedInPricing: true,
    ignoredAsOutlier: false,
    notes: null,
    ...overrides,
  };
}

describe("PricingRecommendationCard", () => {
  it("renders median, sold/active counts, and confidence reasons", () => {
    const html = renderToStaticMarkup(<PricingRecommendationCard summary={readySummary()} />);
    expect(html).toContain("Median");
    expect(html).toContain("$200.00"); // median 20000c
    expect(html).toContain("3 sold");
    expect(html).toContain("1 active");
    expect(html).toContain("Anchored on 3 sold comps.");
  });

  it("renders the needs-comps empty state", () => {
    const empty = readySummary({
      status: "needs_comps",
      compCount: 0,
      soldCompCount: 0,
      activeCompCount: 0,
      medianCents: null,
      confidence: "none",
      confidenceReasons: ["No comps yet. Add real sold or active comps."],
    });
    const html = renderToStaticMarkup(<PricingRecommendationCard summary={empty} />);
    expect(html).toContain("Add sold or active comps");
  });
});

describe("CompsTable", () => {
  it("renders status, the pricing toggles, and edit/delete controls", () => {
    const html = renderToStaticMarkup(
      <CompsTable comps={[row()]} onEdit={() => {}} onDelete={() => {}} onToggle={() => {}} />,
    );
    expect(html).toContain("Air Jordan 1");
    expect(html).toContain("sold");
    expect(html).toContain("Use in pricing");
    expect(html).toContain("Outlier");
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
  });
});
