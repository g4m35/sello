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
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const pageSource = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
const landingSource = readFileSync(
  join(process.cwd(), "src/components/marketing/landing-page.tsx"),
  "utf8",
);
const flat = landingSource.replace(/\s+/g, " ");

describe("landing page", () => {
  it("renders without auth (pure marketing component, no throw)", () => {
    expect(typeof LandingPage).toBe("function");
    expect(() => LandingPage()).not.toThrow();
  });

  it("has page metadata title + description", () => {
    expect(metadata.title).toMatch(/Sello/);
    expect(String(metadata.description ?? "")).toMatch(/listing/i);
  });

  it("does not use marketplace-ready phrasing in metadata", () => {
    expect(String(metadata.title ?? "").toLowerCase()).not.toContain("marketplace-ready");
    expect(String(metadata.description ?? "").toLowerCase()).not.toContain("marketplace-ready");
  });

  it("does not use the old assisted-where-required slogan", () => {
    expect(flat.toLowerCase()).not.toContain("automated where supported");
    expect(flat.toLowerCase()).not.toContain("assisted where required");
  });

  it("mentions supported inventory sync and delist", () => {
    expect(flat.toLowerCase()).toMatch(/inventory sync/i);
    expect(flat.toLowerCase()).toMatch(/delist/i);
    expect(flat.toLowerCase()).toMatch(/supported connected|where supported/i);
  });

  it("has working primary/secondary CTAs", () => {
    expect(landingSource).toContain('href="/dashboard"');
    expect(landingSource).toContain("Start creating listings");
    expect(landingSource).toContain('href="#how-it-works"');
    expect(landingSource).toContain('href="/pricing"');
    expect(landingSource).toContain("View pricing");
  });

  it("eBay FYI: no developer account, seller policies needed for auto-publish", () => {
    expect(flat).toMatch(/no developer account|Connect your normal eBay seller account/i);
    expect(flat).toMatch(/payment, shipping, and returns/i);
  });

  it("positions full auto-pricing / sold comps as paid", () => {
    expect(flat).toMatch(/paid plans unlock/i);
    expect(flat.toLowerCase()).toMatch(/sold comps?/);
  });

  it("describes Grailed as packages/assisted, not direct automation", () => {
    expect(landingSource.toLowerCase()).toMatch(/grailed/);
    expect(landingSource.toLowerCase()).toMatch(/listing packages|packages/);
    expect(landingSource.toLowerCase()).not.toContain("auto-post");
    expect(landingSource.toLowerCase()).not.toContain("auto-submit");
    expect(landingSource.toLowerCase()).not.toContain("scrape");
    expect(landingSource.toLowerCase()).not.toMatch(/directly publish to grailed/);
  });

  it("uses FAQ accordion details/summary", () => {
    expect(landingSource).toContain("<details");
    expect(landingSource).toContain("<summary");
  });

  it("keeps the streamlined flow without overstating marketplace support", () => {
    expect(flat).toMatch(/One streamlined flow/i);
    expect(flat.toLowerCase()).not.toContain("watch the demo");
    expect(flat.toLowerCase()).not.toContain("jump in");
    expect(flat).toMatch(/Publish or export listings/i);
    expect(flat.toLowerCase()).not.toContain("publish across marketplaces");
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
