import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseUserFromCookies: vi.fn(async () => null),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import HomePage, { metadata } from "@/app/page";
import { LandingPage } from "@/components/marketing/landing-page";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const pageSource = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
const layoutSource = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
const landingSource = readFileSync(
  join(process.cwd(), "src/components/marketing/landing-page.tsx"),
  "utf8",
);
const flowSource = readFileSync(
  join(process.cwd(), "src/components/marketing/landing-flow.tsx"),
  "utf8",
);
const ticketSource = readFileSync(
  join(process.cwd(), "src/components/marketing/landing-ticket.tsx"),
  "utf8",
);
const effectsSource = readFileSync(
  join(process.cwd(), "src/components/marketing/landing-effects.tsx"),
  "utf8",
);
const cssSource = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const landingBundle = [landingSource, flowSource, ticketSource].join("\n");
const flat = landingBundle.replace(/\s+/g, " ");

const bannedPhrases = [
  "marketplace-ready",
  "copy-ready",
  "copy and paste",
  "copy & paste",
  "automated where supported",
  "assisted where required",
  "one click",
  "list everywhere",
  "sell everywhere",
  "never double sell",
  "all-in-one",
  "supercharge",
  "revolutionize",
  "watch the demo",
  "jump in",
  "publish across marketplaces",
] as const;

const sectionIds = [
  "nav",
  "hero",
  "how-it-works",
  "listing-creation",
  "marketplaces",
  "inventory-sync",
  "bulk-operations",
  "pricing-intelligence",
  "marketplace-coverage",
  "why-sello",
  "trust",
  "plans",
  "final-cta",
  "footer",
] as const;

describe("landing page", () => {
  it("renders without auth as a pure marketing component", () => {
    expect(typeof LandingPage).toBe("function");
    expect(() => LandingPage()).not.toThrow();
  });

  it("uses listing-led page and root metadata", () => {
    expect(metadata.title).toMatch(/^Sello — /);
    expect(String(metadata.description ?? "")).toMatch(/listing/i);
    expect(layoutSource).toMatch(/title:\s*"Sello — [^"]+"/);
    expect(layoutSource).toMatch(/description:\s*"[^"]*listing[^"]*"/i);
  });

  it("keeps banned positioning out of metadata and landing copy", () => {
    const metadataCopy = [
      String(metadata.title ?? ""),
      String(metadata.description ?? ""),
      pageSource,
      layoutSource,
    ]
      .join(" ")
      .toLowerCase();
    const landingCopy = flat.toLowerCase();

    for (const phrase of bannedPhrases) {
      expect(metadataCopy).not.toContain(phrase);
      expect(landingCopy).not.toContain(phrase);
    }
  });

  it("contains the complete landing narrative", () => {
    expect(landingSource).toContain('className="lp-nav"');
    for (const id of sectionIds) {
      expect(landingSource).toContain(`id="${id}"`);
    }
  });

  it("includes the required operational sections", () => {
    expect(landingSource).toContain('id="inventory-sync"');
    expect(landingSource).toContain('id="marketplaces"');
    expect(landingSource).toContain('id="bulk-operations"');
    expect(flat).toMatch(/inventory sync/i);
    expect(flat).toMatch(/delist/i);
    expect(flat).toMatch(/supported connected|where supported/i);
  });

  it("uses the fixed marketplace vocabulary and mechanisms", () => {
    expect(flat).toMatch(/Publishes direct/);
    expect(flat).toMatch(/Guided publish/);
    expect(flat).toMatch(/On approval/);
    expect(flat).toMatch(/native API, access-gated/i);
    expect(flat).toMatch(/no official APIs exist/i);
    expect(flat).toMatch(/Vinted Pro API/i);
  });

  it("has working primary and secondary CTAs", () => {
    expect(landingSource).toContain('href="/dashboard"');
    expect(landingSource).toContain("Start creating listings");
    expect(landingSource).toContain('href="#how-it-works"');
    expect(landingSource).toContain('href="/pricing"');
    expect(landingSource).toContain("View pricing");
  });

  it("states eBay connection and seller-policy requirements", () => {
    expect(flat).toMatch(/Connect your normal eBay seller account/i);
    expect(flat).toMatch(/payment, shipping, and returns/i);
  });

  it("describes guided channels without direct automation claims", () => {
    expect(flat).toMatch(/Grailed/);
    expect(flat).toMatch(/complete listing/i);
    expect(flat.toLowerCase()).not.toContain("auto-post");
    expect(flat.toLowerCase()).not.toContain("auto-submit");
    expect(flat.toLowerCase()).not.toContain("scrape");
    expect(flat.toLowerCase()).not.toMatch(/directly publish to grailed/);
  });

  it("uses the plan catalog and describes its automation depth", () => {
    expect(landingSource).toContain("PLAN_CATALOG");
    expect(PLAN_CATALOG.free.limits).toMatchObject({
      aiListingsPerMonth: 10,
      autopublishesPerMonth: 10,
      compRefreshesPerMonth: 10,
      marketplaceConnections: 1,
      bulkBatchSize: 5,
      teamSeats: 1,
    });
    expect(PLAN_CATALOG.pro.limits).toMatchObject({
      aiListingsPerMonth: 125,
      autopublishesPerMonth: 125,
      compRefreshesPerMonth: 100,
      marketplaceConnections: 3,
      bulkBatchSize: 25,
      teamSeats: 1,
    });
    expect(PLAN_CATALOG.kingpin.limits).toMatchObject({
      aiListingsPerMonth: 1000,
      autopublishesPerMonth: 1000,
      compRefreshesPerMonth: 750,
      marketplaceConnections: 5,
      bulkBatchSize: 250,
      teamSeats: 5,
    });
    expect(flat).toMatch(/5 items per batch/);
    expect(flat).toMatch(/25 items per batch/);
    expect(flat).toMatch(/250 items per batch/);
    expect(flat).toMatch(/Assisted sold-delist/);
    expect(flat).toMatch(/Full inventory sync/);
    expect(flat).toMatch(/automatic delisting/);
  });

  it("keeps reveal effects additive and content visible by default", () => {
    expect(effectsSource).toContain("IntersectionObserver");
    expect(cssSource).not.toMatch(
      /\.lp-reveal-ready\s+\[data-reveal\][^{]*\{[^}]*opacity:\s*0/,
    );
  });

  it("wires motion as a progressive enhancement with static final states", () => {
    expect(landingSource).toContain('data-sequence="hero"');
    expect(landingSource).toContain('data-sequence="sync"');
    expect(landingSource).toContain('data-sequence="bulk"');
    expect(flowSource).toContain('data-sequence="lifecycle"');
    expect(effectsSource).toContain("prefers-reduced-motion: reduce");
    expect(effectsSource).toContain("max-width: 767px");
    expect(effectsSource).toContain("visibilitychange");
    expect(cssSource).toContain("@keyframes lp-stamp-in");
    expect(cssSource).toContain(".lp.is-motion-paused");
  });

  it("pauses timed sequence work without consuming hidden-tab time", () => {
    expect(effectsSource).toContain("createPausableTimer");
    expect(effectsSource).not.toContain("waitForVisible");
    expect(effectsSource).toContain("timer.pause()");
    expect(effectsSource).toContain("timer.resume()");
  });

  it("keeps lifecycle completion visible without motion and highlights the current row", () => {
    const motionMediaIndex = cssSource.indexOf(
      "@media (prefers-reduced-motion: no-preference)",
    );
    const markerCheckIndex = cssSource.indexOf(".lp-flow__marker::after");

    expect(markerCheckIndex).toBeGreaterThan(-1);
    expect(markerCheckIndex).toBeLessThan(motionMediaIndex);
    expect(cssSource).toContain(".lp-flow__step::before");
    expect(cssSource).toContain("animation: lp-lifecycle-rule");
  });

  it("staggers heading and caption reveals within the restrained reveal system", () => {
    expect(cssSource).toContain(
      '.lp-reveal-ready [data-reveal="rise"] .lp-section__title',
    );
    expect(cssSource).toContain("transition-delay: 80ms");
    expect(cssSource).toContain("transition-delay: 120ms");
  });

  it("routes the Free plan CTA to the dashboard", () => {
    expect(landingSource).toContain('href={id === "free" ? "/dashboard" : "/pricing"}');
    expect(landingSource).toContain('{id === "free" ? "Start free" : "View pricing"}');
  });

  it("redirects signed-in users from / to /dashboard", async () => {
    expect(pageSource).toContain("getSupabaseUserFromCookies");
    expect(pageSource).toContain('redirect("/dashboard")');

    vi.mocked(redirect).mockClear();
    vi.mocked(getSupabaseUserFromCookies).mockResolvedValueOnce({
      id: "user-1",
    } as Awaited<ReturnType<typeof getSupabaseUserFromCookies>>);

    await expect(HomePage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("shows the landing for signed-out visitors", async () => {
    vi.mocked(redirect).mockClear();
    vi.mocked(getSupabaseUserFromCookies).mockResolvedValueOnce(null);
    const result = await HomePage();
    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
