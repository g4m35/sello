import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingPage } from "@/components/marketing/landing-page";
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sello — Listings live. Inventory synchronized.",
  description:
    "Turn photos into complete resale listings, publish through the strongest marketplace workflow available, and keep inventory synchronized through sale and delisting.",
  openGraph: {
    title: "Sello — Listings live. Inventory synchronized.",
    description:
      "Complete resale listings, marketplace-specific publishing, sold-comp pricing, and inventory synchronization through sale and delisting.",
    type: "website",
  },
};

export default async function HomePage() {
  const user = await getSupabaseUserFromCookies();
  if (user) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}
