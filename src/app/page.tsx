import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingPage } from "@/components/marketing/landing-page";
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sello — Photos in. Listings that sell themselves.",
  description:
    "Photos in. Listings that sell themselves. AI listing generation, sold-comp pricing, publish across marketplaces, and inventory sync with autonomous delist.",
  openGraph: {
    title: "Sello — Photos in. Listings that sell themselves.",
    description:
      "AI listing generation, sold-comp pricing, eBay publish, channel packages, and inventory sync — for fashion and streetwear resellers.",
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
