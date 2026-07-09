import Link from "next/link";

import { BrandLoader } from "@/components/ui/brand-loader";

const STEPS = [
  ["01", "Upload photos", "Drop in raw item photos."],
  [
    "02",
    "Sello writes the listing",
    "Title, description, item specifics, measurements, and flaws.",
  ],
  ["03", "Review price & comps", "Sold-comp guidance with a confidence score."],
  [
    "04",
    "Publish or export",
    "Publish on eBay; export marketplace-ready packages elsewhere.",
  ],
  ["05", "Track inventory", "Status tracking across your channels."],
] as const;

const FAQ = [
  ["Do I need an eBay developer account?", "No. Sello connects to your normal eBay seller account."],
  [
    "Can Sello publish directly to every marketplace?",
    "No. Only where official support exists. eBay has the deepest path; others use assisted listing packages and exports.",
  ],
  [
    "Does Sello support Grailed?",
    "Yes, through Grailed-ready assisted listing packages. You post manually where direct publishing is not supported.",
  ],
  [
    "Why is full auto-pricing paid?",
    "It uses paid provider calls and sold-comp discovery, so it is credit-limited and included with paid plans.",
  ],
  [
    "Can I use Sello without eBay?",
    "Yes. Sello still supports listing generation and assisted marketplace exports.",
  ],
  ["Is Sello in early access?", "Yes. Feedback directly shapes what gets built next."],
] as const;

export function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing__nav landing__reveal">
        <Link href="/" className="sidebar__brand-mark" aria-label="Sello home">
          Sello<em>.</em>
        </Link>
        <div className="landing__nav-links">
          <Link href="/pricing" className="btn btn--ghost btn--sm">
            Pricing
          </Link>
          <Link href="#how-it-works" className="btn btn--ghost btn--sm">
            How it works
          </Link>
          <Link href="/dashboard" className="btn btn--primary btn--sm">
            Sign in
          </Link>
        </div>
      </nav>

      <header className="landing__hero">
        <div>
          <p className="landing__eyebrow landing__reveal">Early access · private alpha</p>
          <h1 className="landing__brand landing__reveal landing__reveal--2">
            Sello<em>.</em>
          </h1>
          <p className="landing__lede landing__reveal landing__reveal--3">
            Turn clothing photos into clean resale listings — priced with sold
            comps, ready for the channels that matter. Automated where supported.
            Assisted where required.
          </p>
          <div className="landing__cta landing__reveal landing__reveal--4">
            <Link href="/dashboard" className="btn btn--accent btn--lg">
              Start creating listings
            </Link>
            <Link href="#how-it-works" className="btn btn--secondary btn--lg">
              See how it works
            </Link>
            <Link href="/pricing" className="btn btn--secondary btn--lg">
              View pricing
            </Link>
          </div>
        </div>
        <div className="landing__visual landing__reveal landing__reveal--3" aria-hidden="true">
          <div className="landing__visual-ring" />
          <BrandLoader label="Shaping your listing" size={120} />
        </div>
      </header>

      <section id="how-it-works" className="landing__section">
        <h2 className="landing__section-title">
          From photo to <em>marketplace-ready</em>
        </h2>
        <p className="landing__section-sub">
          Sello removes the repetitive work: titles, descriptions, item specifics,
          measurements, flaws, marketplace formatting, pricing, and status tracking.
        </p>
        <ol className="landing__steps">
          {STEPS.map(([n, h, d]) => (
            <li key={n} className="landing__step">
              <span className="landing__step-n">{n}</span>
              <span className="landing__step-h">{h}</span>
              <span className="landing__step-d">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Marketplace support, honestly</h2>
        <p className="landing__section-sub">
          Deep automation where APIs allow. Assisted packages where they don&apos;t.
        </p>
        <div className="landing__split">
          <article className="landing__panel">
            <h3>eBay</h3>
            <p>The deepest automation path, through eBay&apos;s official APIs.</p>
          </article>
          <article className="landing__panel">
            <h3>Grailed, Poshmark, Depop</h3>
            <p>
              Marketplace-ready assisted listing packages and copy flows. You stay
              in control and post where direct publishing is not supported.
            </p>
          </article>
          <article className="landing__panel">
            <h3>Everywhere else</h3>
            <p>Supported through export and copy workflows first.</p>
          </article>
        </div>
        <p className="landing__truth">
          Automated where supported. <em>Assisted</em> where required.
        </p>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Sold-comp pricing intelligence</h2>
        <p className="landing__section-sub">
          Sello uses sold-comp discovery and confidence scoring to back every price
          with real evidence.
        </p>
        <div className="landing__panel" style={{ maxWidth: 640 }}>
          <h3>Evidence-backed prices</h3>
          <p>
            Create listings for free and preview pricing. Paid plans unlock full
            automatic sold-comp discovery, confidence scoring, and refreshes. Full
            auto-pricing uses paid provider calls, so it is credit-limited and
            included with paid plans.
          </p>
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Connecting eBay</h2>
        <div className="landing__panel" style={{ maxWidth: 640 }}>
          <h3>No developer account needed</h3>
          <p>
            You do not need an eBay developer account. Sello connects to your normal
            eBay seller account. To auto-publish, eBay requires standard seller
            policies like payment, shipping, and returns. Sello checks this during
            onboarding.
          </p>
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Grailed-ready, assisted</h2>
        <div className="landing__panel" style={{ maxWidth: 640 }}>
          <h3>Complete listing packages</h3>
          <p>
            For Grailed, Sello prepares title, designer, category, size, description,
            measurements, price, photo order, and copy-ready fields. You stay in
            control when direct publishing is not supported.
          </p>
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Early access pricing</h2>
        <p className="landing__section-sub">
          Free users can create listings and preview pricing. Paid plans unlock
          automatic sold-comp discovery, confidence scoring, and evidence-backed
          price recommendations.
        </p>
        <div className="landing__split">
          <article className="landing__panel">
            <h3>Free / Trial</h3>
            <p>Create listings, basic pricing preview, limited auto-comp credits.</p>
          </article>
          <article className="landing__panel">
            <h3>Starter</h3>
            <p>Full auto-pricing, sold comps, confidence scores, refresh limits.</p>
          </article>
          <article className="landing__panel">
            <h3>Seller / Pro</h3>
            <p>More listings, more comp credits, bulk tools.</p>
          </article>
        </div>
        <div style={{ marginTop: 18 }}>
          <Link href="/pricing" className="btn btn--secondary">
            Compare current plans
          </Link>
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">FAQ</h2>
        <div className="landing__faq">
          {FAQ.map(([q, a]) => (
            <article key={q} className="landing__panel">
              <h3>{q}</h3>
              <p>{a}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing__footer">
        <div className="landing__footer-links">
          <Link href="/pricing">Pricing</Link>
          <span>·</span>
          <Link href="/dashboard">Start creating listings</Link>
          <span>·</span>
          <span>Sello is in early access.</span>
        </div>
      </footer>
    </main>
  );
}
