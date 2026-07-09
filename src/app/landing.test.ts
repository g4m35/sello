import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import Landing, { metadata } from "@/app/page";

const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
// Whitespace-insensitive view so multi-word copy that wraps across lines in JSX
// still matches.
const flat = source.replace(/\s+/g, " ");

describe("landing page", () => {
  it("renders without auth (pure server component, no throw)", () => {
    expect(typeof Landing).toBe("function");
    expect(() => Landing()).not.toThrow();
  });

  it("has page metadata title + description", () => {
    expect(metadata.title).toMatch(/Sello/);
    expect(String(metadata.description ?? "")).toMatch(/listing/i);
  });

  it("uses the honest positioning phrase", () => {
    expect(flat).toContain("Automated where supported. Assisted where required.");
  });

  it("has working primary/secondary CTAs", () => {
    expect(source).toContain('href="/dashboard"');
    expect(source).toContain("Start creating listings");
    expect(source).toContain('href="#how-it-works"');
    expect(source).toContain('href="/pricing"');
    expect(source).toContain("View pricing");
  });

  it("eBay FYI: no developer account, seller policies needed for auto-publish", () => {
    expect(flat).toMatch(/do not need an eBay developer account/i);
    expect(flat).toMatch(/payment, shipping, and returns/i);
  });

  it("positions full auto-pricing / sold comps as paid/limited", () => {
    expect(flat).toMatch(/Paid plans unlock/i);
    expect(source).toMatch(/credit-limited/i);
  });

  it("describes Grailed as assisted, not direct automation", () => {
    expect(source).toMatch(/assisted/i);
    expect(source.toLowerCase()).not.toContain("auto-post");
    expect(source.toLowerCase()).not.toContain("auto-submit");
    expect(source.toLowerCase()).not.toContain("scrape");
    expect(source.toLowerCase()).not.toMatch(/directly publish to grailed/);
  });
});
