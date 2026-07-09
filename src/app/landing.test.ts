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
const demoSource = readFileSync(
  join(process.cwd(), "src/components/marketing/landing-demo.tsx"),
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

  it("leads with outcome headline and brand", () => {
    expect(flat).toContain("Photos in. Marketplace-ready listings out.");
    expect(landingSource).toContain("landing__brand-line");
    expect(flat).toContain("Automated where supported. Assisted where required.");
  });

  it("embeds a staged product demo flow", () => {
    expect(landingSource).toContain("LandingDemo");
    expect(demoSource).toContain("Upload");
    expect(demoSource).toContain("Draft");
    expect(demoSource).toContain("Price");
    expect(demoSource).toContain("Publish");
    expect(demoSource).toContain("role=\"tablist\"");
  });

  it("has working primary/secondary CTAs", () => {
    expect(landingSource).toContain('href="/dashboard"');
    expect(landingSource).toContain("Start creating listings");
    expect(landingSource).toContain('href="#demo"');
    expect(landingSource).toContain("See how it works");
    expect(landingSource).toContain('href="/pricing"');
    expect(landingSource).toContain("View pricing");
  });

  it("eBay FYI: no developer account, seller policies needed for auto-publish", () => {
    expect(flat).toMatch(/do not need an eBay developer account/i);
    expect(flat).toMatch(/payment, shipping, and returns/i);
  });

  it("positions full auto-pricing / sold comps as paid/limited", () => {
    expect(flat).toMatch(/Paid plans unlock/i);
    expect(landingSource).toMatch(/credit-limited/i);
  });

  it("describes Grailed as assisted, not direct automation", () => {
    expect(landingSource).toMatch(/assisted/i);
    expect(landingSource.toLowerCase()).not.toContain("auto-post");
    expect(landingSource.toLowerCase()).not.toContain("auto-submit");
    expect(landingSource.toLowerCase()).not.toContain("scrape");
    expect(landingSource.toLowerCase()).not.toMatch(/directly publish to grailed/);
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
