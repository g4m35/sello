import Link from "next/link";

import { LandingDemo } from "@/components/marketing/landing-demo";

const FAQ = [
  [
    "Do I need an eBay developer account?",
    "No. You do not need an eBay developer account. Sello connects to your normal eBay seller account. To auto-publish, eBay requires standard seller policies like payment, shipping, and returns — Sello checks this during onboarding.",
  ],
  [
    "Can Sello publish directly to every marketplace?",
    "No. Only where official support exists. eBay has the deepest path; Grailed, Poshmark, and Depop use assisted listing packages and exports.",
  ],
  [
    "Why is full auto-pricing paid?",
    "It uses paid provider calls and sold-comp discovery, so it is credit-limited and included with paid plans. Create listings for free and preview pricing; paid plans unlock full automatic sold-comp discovery.",
  ],
  [
    "Is Sello in early access?",
    "Yes. Feedback directly shapes what gets built next.",
  ],
] as const;

export function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing__nav landing__reveal">
        <Link href="/" className="sidebar__brand-mark" aria-label="Sello home">
          Sello<em>.</em>
        </Link>
        <div className="landing__nav-links">
          <Link href="#demo" className="btn btn--ghost btn--sm">
            Demo
          </Link>
          <Link href="/pricing" className="btn btn--ghost btn--sm">
            Pricing
          </Link>
          <Link href="/dashboard" className="btn btn--primary btn--sm">
            Sign in
          </Link>
        </div>
      </nav>

      <header className="landing__hero">
        <div className="landing__hero-copy">
          <p className="landing__eyebrow landing__reveal">Early access · private alpha</p>
          <p className="landing__brand-line landing__reveal landing__reveal--2">
            Sello<em>.</em>
          </p>
          <h1 className="landing__headline landing__reveal landing__reveal--3">
            Photos in. Marketplace-ready listings out.
          </h1>
          <p className="landing__lede landing__reveal landing__reveal--4">
            Turn clothing photos into clean resale listings — priced with sold
            comps, ready for the channels that matter. Automated where supported.
            Assisted where required.
          </p>
          <div className="landing__cta landing__reveal landing__reveal--4">
            <Link href="/dashboard" className="btn btn--accent btn--lg">
              Start creating listings
            </Link>
            <Link href="#demo" className="btn btn--secondary btn--lg">
              See how it works
            </Link>
            <Link href="/pricing" className="btn btn--ghost btn--lg">
              View pricing
            </Link>
          </div>
        </div>

        <div className="landing__hero-demo landing__reveal landing__reveal--3">
          <LandingDemo />
        </div>
      </header>

      <section className="landing__section landing__section--tight">
        <p className="landing__problem">
          Manual listing is the bottleneck — titles, specifics, measurements,
          comps, and marketplace formatting, repeated for every item.
          <em> Sello does that pass for you.</em>
        </p>
      </section>

      <section id="how-it-works" className="landing__section">
        <h2 className="landing__section-title">
          From photo to <em>marketplace-ready</em>
        </h2>
        <p className="landing__section-sub">
          One flow: upload → draft → sold-comp price → publish or export. Watch
          the demo above, or jump in and create your first listing.
        </p>
        <ol className="landing__flow">
          <li>
            <span>01</span>
            <strong>Upload photos</strong>
            <p>Drop in raw item photos.</p>
          </li>
          <li>
            <span>02</span>
            <strong>Sello writes the listing</strong>
            <p>Title, description, item specifics, measurements, and flaws.</p>
          </li>
          <li>
            <span>03</span>
            <strong>Review price &amp; comps</strong>
            <p>Sold-comp guidance with a confidence score.</p>
          </li>
          <li>
            <span>04</span>
            <strong>Publish or export</strong>
            <p>Publish on eBay; export marketplace-ready packages elsewhere.</p>
          </li>
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
            <p>
              The deepest automation path, through eBay&apos;s official APIs. You do
              not need an eBay developer account — connect your normal seller
              account. Auto-publish needs standard seller policies like payment,
              shipping, and returns.
            </p>
          </article>
          <article className="landing__panel">
            <h3>Grailed, Poshmark, Depop</h3>
            <p>
              Marketplace-ready assisted listing packages and copy flows. You stay
              in control and post where direct publishing is not supported.
            </p>
          </article>
          <article className="landing__panel">
            <h3>Sold-comp pricing</h3>
            <p>
              Evidence-backed prices from sold comps. Paid plans unlock full
              automatic discovery, confidence scoring, and refreshes — credit-limited
              because it uses paid provider calls.
            </p>
          </article>
        </div>
        <p className="landing__truth">
          Automated where supported. <em>Assisted</em> where required.
        </p>
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
        <div className="landing__section-cta">
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

      <section className="landing__section landing__closing">
        <h2 className="landing__section-title">
          Ready to list <em>faster</em>?
        </h2>
        <p className="landing__section-sub">
          Start free. Bring photos. Leave with marketplace-ready drafts.
        </p>
        <div className="landing__cta">
          <Link href="/dashboard" className="btn btn--accent btn--lg">
            Start creating listings
          </Link>
          <Link href="/pricing" className="btn btn--secondary btn--lg">
            View pricing
          </Link>
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
