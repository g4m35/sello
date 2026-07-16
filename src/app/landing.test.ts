import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import Landing, { metadata } from "@/app/page";

const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
const componentsSource = [
  "Hero.tsx",
  "DemoFlow.tsx",
  "FeatureGrid.tsx",
  "LandingNav.tsx",
  "MarketplaceSection.tsx",
  "BetaCTA.tsx",
]
  .map((file) =>
    readFileSync(join(process.cwd(), "src/components/landing", file), "utf8"),
  )
  .join("\n");
const stylesSource = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
// Whitespace-insensitive view so multi-word copy that wraps across lines in JSX
// still matches.
const flat = `${source}\n${componentsSource}`.replace(/\s+/g, " ");

describe("landing page", () => {
  it("renders without auth (pure server component, no throw)", () => {
    expect(typeof Landing).toBe("function");
    expect(() => Landing()).not.toThrow();
  });

  it("has page metadata title + description", () => {
    expect(metadata.title).toMatch(/Sello/);
    expect(String(metadata.description ?? "")).toMatch(/listing/i);
  });

  it("uses the planned Sello positioning", () => {
    expect(flat).toContain("List everywhere. Sell faster. Stay in control.");
    expect(flat).toContain("The AI listing system for modern resellers");
  });

  it("has focused CTAs without duplicate demo buttons", () => {
    expect(componentsSource).toContain('href="/dashboard"');
    expect(componentsSource).toContain("Start listing");
    expect(componentsSource).toContain('href: "#demo"');
    expect(componentsSource).toContain('href: "#automation"');
    expect(componentsSource).toContain('href: "#marketplaces"');
    expect(componentsSource).toContain('href: "/contact"');
    expect(componentsSource).toContain("Request access");
    expect(componentsSource).not.toContain("Watch demo");
    expect(componentsSource).not.toContain("See demo");
    expect(componentsSource).not.toContain("landing-nav__cta");
  });

  it("keeps the rendered landing page simple", () => {
    expect(source).toContain("<Hero />");
    expect(source).toContain("<DemoFlow />");
    expect(source).toContain("<FeatureGrid />");
    expect(source).toContain("<MarketplaceSection />");
    expect(source).not.toContain("ProblemSection");
    expect(source).not.toContain("SolutionSection");
    expect(source).not.toContain("TrustSection");
    expect(source).not.toContain("FAQ");
    expect(componentsSource).not.toContain("landing-marketplace-row");
    expect(componentsSource).not.toContain("MockDashboard");
    expect(componentsSource).not.toContain("#proof");
    expect(componentsSource).not.toContain("#faq");
  });

  it("embeds a continuous animated workflow ending in an eBay draft", () => {
    expect(flat).toContain("Supreme Box Logo Hoodie Black FW21");
    expect(flat).toContain("See what Sello does in one pass.");
    expect(flat).toContain("Actual animation of one resale listing moving through Sello");
    expect(componentsSource).toContain("motion-photo");
    expect(componentsSource).toContain("motion-scan");
    expect(componentsSource).toContain("motion-marketplace");
    expect(componentsSource).toContain("motion-ebay");
    expect(flat).toContain("Sold median");
    expect(flat).toContain("Comp range");
    expect(flat).toContain("Est. payout");
    expect(flat).toContain("Chosen marketplaces");
    expect(flat).toContain("SKU: {item.sku}");
    expect(flat).toContain("Draft ready for seller review");
    expect(flat).toContain("Seller approval gate required before publishing");
    expect(componentsSource).toContain("motion-price-metrics");
    expect(componentsSource).toContain("motion-marketplace-grid");
    expect(componentsSource).toContain("motion-ebay__image");
    expect(componentsSource).not.toContain("Brand, size, condition, color, flaws");
    expect(componentsSource).not.toContain("Recommended list price from sold comps.");
    expect(componentsSource).not.toContain("tourScenes");
    expect(componentsSource).not.toContain("tour-screen");
    expect(componentsSource).not.toContain("demo-step");
  });

  it("keeps the capability section compact and direct", () => {
    expect(flat).toContain("Sello is an automated listing system for resellers.");
    expect(flat).toContain("Automated listing drafts");
    expect(flat).toContain("Automated sold-comp pricing");
    expect(componentsSource).toContain("feature-summary__item");
    expect(componentsSource).not.toContain("What it is");
    expect(componentsSource).not.toContain("Upload item photos, get a clean listing");
    expect(componentsSource).not.toContain("feature-card");
    expect(componentsSource).not.toContain("feature-grid");
  });

  it("uses honest marketplace wording without overpromising direct publishing", () => {
    expect(flat).toContain(
      "Sello uses the deepest available workflow for each marketplace",
    );
    expect(flat).toContain("direct publishing only where technically and policy-wise available");
    expect(flat).toContain("More marketplaces are coming");
    expect(flat).toContain("More coming");
    expect(componentsSource).toContain("marketplace-showcase");
    expect(componentsSource).toContain("marketplace-card--coming-soon");
    expect(componentsSource).not.toContain("marketplace-table");
    expect(flat.toLowerCase()).not.toContain("auto-post");
    expect(flat.toLowerCase()).not.toContain("auto-submit");
    expect(flat.toLowerCase()).not.toContain("scrape");
  });

  it("keeps landing colors aligned with Sello theme tokens", () => {
    const landingStyles = stylesSource.slice(stylesSource.indexOf(".landing-page"));

    expect(landingStyles).toContain("--landing-accent: var(--accent)");
    expect(landingStyles).toContain("--landing-bg: var(--bg)");
    expect(landingStyles).toContain("--landing-surface: var(--surface)");
    expect(landingStyles).toContain("var(--status-ready-bg)");
    expect(landingStyles).not.toMatch(/violet|purple|#6366f1|#8b5cf6|#3b82f6/i);
  });

  it("keeps landing polish details from regressing", () => {
    const landingStyles = stylesSource.slice(stylesSource.indexOf(".landing-page"));
    const rootLayout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

    expect(rootLayout).toContain("antialiased");
    expect(landingStyles).toContain("text-wrap: balance");
    expect(landingStyles).toContain("text-wrap: pretty");
    expect(landingStyles).toContain("font-variant-numeric: tabular-nums");
    expect(landingStyles).toContain("transform: scale(0.96)");
    expect(landingStyles).toContain("--landing-image-outline: rgba(0, 0, 0, 0.1)");
    expect(landingStyles).toContain("--landing-image-outline: rgba(255, 255, 255, 0.1)");
    expect(landingStyles).toContain("outline: 1px solid var(--landing-image-outline)");
    expect(landingStyles).toContain("--landing-shadow-ring");
    expect(landingStyles).not.toContain("transition: all");
    expect(landingStyles).toContain("@keyframes motionScan");
    expect(landingStyles).toContain("motion-panel--paused");
    expect(componentsSource).toContain("tour-control__glyph--active");
  });
});
