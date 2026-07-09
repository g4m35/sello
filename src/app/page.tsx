import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingPage } from "@/components/marketing/landing-page";
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sello — Photos in. Marketplace-ready listings out.",
  description:
    "Turn clothing photos into clean resale listings — priced with sold comps, ready for the channels that matter. Automated where supported. Assisted where required.",
  openGraph: {
    title: "Sello — Photos in. Marketplace-ready listings out.",
    description:
      "AI listing generation, sold-comp pricing guidance, and marketplace-ready drafts for fashion resellers. Automated where supported. Assisted where required.",
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
