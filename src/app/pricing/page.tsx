import Link from "next/link";

import { PlanCards } from "@/components/billing/plan-cards";
import { PLAN_CATALOG } from "@/lib/billing/plans";

export const metadata = {
  title: "Pricing - Sello",
  description: "Simple plans for resellers. Start free, upgrade when you list consistently.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-neutral-900">Pricing</h1>
        <p className="mx-auto mt-3 max-w-xl text-neutral-600">
          Start free. Upgrade when you are listing consistently, and scale up when you
          are running volume.
        </p>
      </div>

      <div className="mt-12">
        <PlanCards
          renderCta={(id) => (
            <Link
              href={id === "free" ? "/" : "/settings/billing"}
              className="block w-full rounded-lg bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-800"
            >
              {id === "free" ? "Get started" : `Choose ${PLAN_CATALOG[id].name}`}
            </Link>
          )}
        />
      </div>

      <p className="mt-8 text-center text-sm text-neutral-500">
        Prices in USD. Cancel anytime from your billing settings.
      </p>
    </main>
  );
}
