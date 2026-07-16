import type { Metadata } from "next";

import { BetaCTA } from "@/components/landing/BetaCTA";
import { DemoFlow } from "@/components/landing/DemoFlow";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { Hero } from "@/components/landing/Hero";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";
import { MarketplaceSection } from "@/components/landing/MarketplaceSection";

export const metadata: Metadata = {
  title: "Sello — The AI listing system for modern resellers",
  description:
    "Sello turns raw item photos into complete resale listings with AI-generated titles, descriptions, pricing guidance, platform-specific fields, and marketplace publishing workflows.",
  openGraph: {
    title: "Sello — The AI listing system for modern resellers",
    description:
      "List everywhere, sell faster, and stay in control with AI listing generation, sold-comp pricing guidance, marketplace workflows, and inventory protection.",
    type: "website",
  },
};

export default function Landing() {
  return (
    <main className="landing-page">
      <LandingNav />
      <Hero />
      <DemoFlow />
      <FeatureGrid />
      <MarketplaceSection />
      <BetaCTA />
      <LandingFooter />
    </main>
  );
}
