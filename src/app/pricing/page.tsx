import Link from "next/link";

import { PlanCards } from "@/components/billing/plan-cards";
import { PLAN_CATALOG } from "@/lib/billing/plans";

export const metadata = {
  title: "Pricing - Sello",
  description: "Simple plans for resellers. Start free, upgrade when you list consistently.",
};

export default function PricingPage() {
  return (
    <main className="public-page">
      <section className="public-hero public-hero--compact">
        <nav className="public-nav" aria-label="Main">
          <Link href="/" className="public-brand">
            Sello<em>.</em>
          </Link>
          <div className="public-nav__links">
            <Link href="/dashboard" className="btn btn--secondary btn--sm">
              Sign in
            </Link>
          </div>
        </nav>

        <div className="badge badge--outline">Simple reseller plans</div>
        <h1 className="t-display public-hero__title">Pricing</h1>
        <p className="public-hero__copy">
          Start free. Upgrade when you are listing consistently, and scale up when you
          are running volume.
        </p>
      </section>

      <section className="public-section public-section--pricing">
        <PlanCards
          renderCta={(id) => (
            <Link
              href={id === "free" ? "/" : "/settings/billing"}
              className={`btn ${id === "free" ? "btn--secondary" : "btn--primary"} plan-card__button`}
            >
              {id === "free" ? "Get started" : `Choose ${PLAN_CATALOG[id].name}`}
            </Link>
          )}
        />
      </section>

      <p className="public-footer public-footer--solo">
        Prices in USD. Cancel anytime from your billing settings.
      </p>
    </main>
  );
}
