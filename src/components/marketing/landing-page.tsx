import Link from "next/link";

import { LandingDemo } from "@/components/marketing/landing-demo";

const FAQ = [
  [
    "Do I need an eBay developer account?",
    "No. Connect your normal eBay seller account and Sello handles the rest. For auto-publish, eBay needs standard seller policies — payment, shipping, and returns — and Sello checks those during onboarding so you are not guessing.",
  ],
  [
    "Can Sello publish to every marketplace?",
    "Where account access and eligibility allow, eBay gets the deepest automation through official APIs. Grailed, Poshmark, and Depop use assisted listing packages you post yourself.",
  ],
  [
    "Does inventory sync across channels?",
    "Sello keeps one inventory for draft, live, sold, and delisted items. When something sells, it helps clean up supported connected channels so you are not chasing stale listings by hand.",
  ],
  [
    "How does sold-comp pricing work?",
    "Sello finds real sold comps, scores confidence, and recommends a list price from what buyers actually paid. Create listings free and preview pricing; paid plans unlock full automatic discovery and refreshes so your ask stays sharp as the market moves.",
  ],
] as const;

export function LandingPage() {
  return (
    <main className="landing">
      <div className="landing__nav-bar">
        <nav className="landing__nav landing__reveal">
          <Link href="/" className="landing__nav-brand" aria-label="Sello home">
            Sello<em>.</em>
          </Link>
          <div className="landing__nav-links">
            <Link href="#demo" className="landing__nav-link">
              Demo
            </Link>
            <Link href="/pricing" className="landing__nav-link">
              Pricing
            </Link>
            <Link href="/dashboard" className="btn btn--primary btn--sm landing__nav-cta">
              Sign in
            </Link>
          </div>
        </nav>
      </div>

      <header className="landing__hero">
        <div className="landing__hero-copy">
          <p className="landing__eyebrow landing__reveal">Early access · private alpha</p>
          <p className="landing__brand-line landing__reveal landing__reveal--2">
            Sello<em>.</em>
          </p>
          <h1 className="landing__headline landing__reveal landing__reveal--3">
            Photos in. Listings that sell themselves.
          </h1>
          <p className="landing__lede landing__reveal landing__reveal--4">
            AI writes the listing, sold comps guide the price, Sello publishes
            where supported, prepares listings for assisted channels, and keeps
            supported connected inventory in sync.
          </p>
          <div className="landing__cta landing__reveal landing__reveal--4">
            <Link href="/dashboard" className="btn btn--accent btn--lg">
              Start creating listings
            </Link>
            <Link href="#how-it-works" className="btn btn--secondary btn--lg">
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

      <section id="how-it-works" className="landing__section">
        <h2 className="landing__section-title">
          From photo to <em>live</em>
        </h2>
        <p className="landing__section-sub">
          One streamlined flow: upload → listing → sold-comp price → publish or
          export → supported inventory sync.
        </p>
        <ol className="landing__flow">
          <li>
            <span>01</span>
            <strong>Upload photos</strong>
            <p>Drop in raw item shots. No studio required.</p>
          </li>
          <li>
            <span>02</span>
            <strong>AI writes the listing</strong>
            <p>Title, specifics, measurements, and flaws — done for you.</p>
          </li>
          <li>
            <span>03</span>
            <strong>Publish or export listings</strong>
            <p>Eligible eBay publishing plus ready-to-post packages for assisted channels.</p>
          </li>
          <li>
            <span>04</span>
            <strong>Inventory sync where supported</strong>
            <p>
              Track status and delist supported connected channels when an item sells.
            </p>
          </li>
        </ol>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">What Sello runs for you</h2>
        <p className="landing__section-sub">
          Less busywork. More listings live. Status that stays honest.
        </p>
        <div className="landing__split">
          <article className="landing__panel">
            <h3>eBay on autopilot</h3>
            <p>
              When eBay access and publishing are enabled, Sello generates the
              listing, prices from sold comps, and publishes through official APIs —
              no developer account or copy-paste marathon.
            </p>
          </article>
          <article className="landing__panel">
            <h3>Assisted channels, ready</h3>
            <p>
              Grailed, Poshmark, and Depop get listing packages built for you.
              You review and post them where direct API access is unavailable.
            </p>
          </article>
          <article className="landing__panel">
            <h3>Inventory that cleans itself up</h3>
            <p>
              Draft, live, sold, delisted — one source of truth. When an item
              sells, Sello helps you delist on supported connected channels so
              you can avoid double-sales and stale stock.
            </p>
          </article>
        </div>
      </section>

      <section className="landing__section landing__section--comps">
        <h2 className="landing__section-title">
          Price like the market <em>already did</em>
        </h2>
        <p className="landing__section-sub landing__section-sub--wide">
          Stop guessing. Sello hunts real sold comps, scores confidence, and
          recommends a list price that matches what buyers actually paid —
          not what wishful listings ask. Create free and preview pricing; paid
          plans unlock full automatic discovery and refreshes so your ask stays
          sharp as the market moves.
        </p>
        <ul className="landing__comp-points">
          <li>
            <strong>Sold evidence, not vibes</strong>
            <span>Comps from real closes — confidence you can defend.</span>
          </li>
          <li>
            <strong>Refresh when it matters</strong>
            <span>Re-run discovery so yesterday&apos;s price doesn&apos;t kill today&apos;s sale.</span>
          </li>
          <li>
            <strong>Built for volume sellers</strong>
            <span>Price faster across inventory without living in tabs.</span>
          </li>
        </ul>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Early access pricing</h2>
        <div className="landing__split">
          <article className="landing__panel">
            <h3>Free / Trial</h3>
            <p>Create listings, preview pricing, limited auto-comp credits.</p>
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
            <details key={q} className="landing__faq-item">
              <summary className="landing__faq-q">{q}</summary>
              <p className="landing__faq-a">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing__section landing__closing">
        <h2 className="landing__section-title">
          Less listing work. <em>More selling.</em>
        </h2>
        <p className="landing__section-sub">
          Start free. Bring photos. Let Sello run the loop.
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
