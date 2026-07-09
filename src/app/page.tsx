import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingPage } from "@/components/marketing/landing-page";
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sello — Turn clothing photos into resale listings",
  description:
    "Sello is an AI-native resale operating system for fashion sellers. Turn item photos into clean listings, sold-comp pricing guidance, and marketplace-ready drafts. Automated where supported. Assisted where required.",
  openGraph: {
    title: "Sello — Turn clothing photos into resale listings",
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
