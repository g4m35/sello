import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlanCards } from "./plan-cards";

describe("PlanCards", () => {
  it("renders all three plans with their prices", () => {
    const html = renderToStaticMarkup(<PlanCards />);
    expect(html).toContain("Free");
    expect(html).toContain("Pro");
    expect(html).toContain("Kingpin");
    expect(html).toContain("$0");
    expect(html).toContain("$20/mo");
    expect(html).toContain("$119/mo");
  });

  it("shows headline limits and marks the current plan", () => {
    const html = renderToStaticMarkup(<PlanCards currentPlan="pro" />);
    expect(html).toContain("125 AI listings / mo");
    expect(html).toContain("1,000 AI listings / mo");
    expect(html).toContain("Current");
  });

  it("renders an injected CTA per plan", () => {
    const html = renderToStaticMarkup(
      <PlanCards renderCta={(id) => <button>pick-{id}</button>} />,
    );
    expect(html).toContain("pick-free");
    expect(html).toContain("pick-pro");
    expect(html).toContain("pick-kingpin");
  });
});
