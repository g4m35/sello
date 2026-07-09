import type { Metadata } from "next";
import Link from "next/link";

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

function PublicNav() {
  return (
    <nav className="public-nav" aria-label="Main">
      <Link href="/" className="public-brand">
        Sello<em>.</em>
      </Link>
      <div className="public-nav__links">
        <Link href="/pricing" className="btn btn--ghost btn--sm">
          Pricing
        </Link>
        <Link href="/dashboard" className="btn btn--secondary btn--sm">
          Sign in
        </Link>
      </div>
    </nav>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="public-section">
      {title && <h2 className="t-h1 public-section__title">{title}</h2>}
      {children}
    </section>
  );
}

function InfoCard({
  title,
  children,
  meta,
}: {
  title: string;
  children: React.ReactNode;
  meta?: string;
}) {
  return (
    <div className="card public-card">
      <div className="card__body">
        {meta && <div className="t-micro public-card__meta">{meta}</div>}
        <h3 className="t-h2 public-card__title">{title}</h3>
        <div className="t-small public-card__copy">{children}</div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <main className="public-page">
      <header className="public-hero">
        <PublicNav />
        <div className="badge badge--outline">Early access · private alpha</div>
        <h1 className="t-display public-hero__title">
          Turn clothing photos into resale listings.
        </h1>
        <p className="public-hero__copy">
          Sello writes clean listings, prepares marketplace-ready drafts, and helps
          price items with sold-comp intelligence. Automated where supported.
          Assisted where required.
        </p>
        <div className="public-actions">
          <Link href="/dashboard" className="btn btn--primary btn--lg">
            Start creating listings
          </Link>
          <Link href="#how-it-works" className="btn btn--secondary btn--lg">
            See how it works
          </Link>
          <Link href="/pricing" className="btn btn--secondary btn--lg">
            View pricing
          </Link>
        </div>
      </header>

      <Section id="how-it-works" title="From photo to marketplace-ready">
        <ol className="public-grid public-grid--steps">
          {[
            ["1", "Upload photos", "Drop in raw item photos."],
            [
              "2",
              "Sello writes the listing",
              "Title, description, item specifics, measurements, and flaws.",
            ],
            ["3", "Review price & comps", "Sold-comp guidance with a confidence score."],
            [
              "4",
              "Publish or export",
              "Publish on eBay; export marketplace-ready packages elsewhere.",
            ],
            ["5", "Track inventory", "Status tracking across your channels."],
          ].map(([n, title, copy]) => (
            <li key={n} className="card public-card">
              <div className="card__body">
                <div className="t-micro">Step {n}</div>
                <h3 className="t-h2 public-card__title">{title}</h3>
                <p className="t-small public-card__copy">{copy}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="public-note">
          Sello removes the repetitive work: titles, descriptions, item specifics,
          measurements, flaws, marketplace formatting, pricing, and status tracking.
        </p>
      </Section>

      <Section title="Marketplace support, honestly">
        <div className="public-grid">
          <InfoCard title="eBay">
            The deepest automation path, through eBay&apos;s official APIs.
          </InfoCard>
          <InfoCard title="Grailed, Poshmark, Depop">
            Marketplace-ready assisted listing packages and copy flows. You stay
            in control and post where direct publishing is not supported.
          </InfoCard>
          <InfoCard title="Everywhere else">
            Supported through export and copy workflows first.
          </InfoCard>
        </div>
        <p className="public-note public-note--strong">
          Automated where supported. Assisted where required.
        </p>
      </Section>

      <Section title="Sold-comp pricing intelligence">
        <div className="card public-card">
          <div className="card__body public-card__body-lg">
            <p className="public-note public-note--flush">
              Sello uses sold-comp discovery and confidence scoring to back every
              price with real evidence.
            </p>
            <p className="t-small public-card__copy">
              Create listings for free and preview pricing. Paid plans unlock full
              automatic sold-comp discovery, confidence scoring, and refreshes. Full
              auto-pricing uses paid provider calls, so it is credit-limited and
              included with paid plans.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Connecting eBay">
        <InfoCard title="No developer account needed">
          You do not need an eBay developer account. Sello connects to your normal
          eBay seller account. To auto-publish, eBay requires standard seller
          policies like payment, shipping, and returns. Sello checks this during
          onboarding.
        </InfoCard>
      </Section>

      <Section title="Grailed-ready, assisted">
        <InfoCard title="Complete listing packages">
          For Grailed, Sello prepares title, designer, category, size, description,
          measurements, price, photo order, and copy-ready fields. You stay in
          control when direct publishing is not supported.
        </InfoCard>
      </Section>

      <Section title="Early access pricing">
        <div className="public-grid">
          {[
            ["Free / Trial", ["Create listings", "Basic pricing preview", "Limited auto-comp credits"]],
            ["Starter", ["Full auto-pricing", "Sold comps", "Confidence scores", "Refresh limits"]],
            ["Seller / Pro", ["More listings", "More comp credits", "Bulk tools"]],
          ].map(([name, feats]) => (
            <div key={name as string} className="card public-card">
              <div className="card__body">
                <div className="t-h2 public-card__title">{name as string}</div>
                <div className="badge badge--outline public-card__badge">Early access</div>
                <ul className="public-list">
                  {(feats as string[]).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <p className="public-note">
          Free users can create listings and preview pricing. Paid plans unlock
          automatic sold-comp discovery, confidence scoring, and evidence-backed
          price recommendations.
        </p>
        <Link href="/pricing" className="btn btn--secondary">
          Compare current plans
        </Link>
      </Section>

      <Section title="FAQ">
        <div className="public-stack">
          {[
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
          ].map(([q, a]) => (
            <InfoCard key={q} title={q}>
              {a}
            </InfoCard>
          ))}
        </div>
      </Section>

      <footer className="public-footer">
        <Link href="/pricing">Pricing</Link>
        <span>·</span>
        <Link href="/dashboard">Start creating listings</Link>
        <span>·</span>
        <span>Sello is in early access.</span>
      </footer>
    </main>
  );
}
