import Link from "next/link";

import { LandingEffects } from "@/components/marketing/landing-effects";
import { LandingFlow, type FlowStep } from "@/components/marketing/landing-flow";
import { LandingTicket, type TicketItem } from "@/components/marketing/landing-ticket";

const HERO_TICKET: TicketItem = {
  lot: "Lot 0417 — Draft",
  art: "coat",
  title: "Acne Studios wool overcoat — charcoal",
  category: "Men → Coats & Jackets",
  size: "M",
  condition: "Excellent",
  measurements: "P2P 21½″ · L 38″",
  price: "$285",
  confidence: 82,
  comps: [],
  lanes: [
    { name: "eBay", mode: "publish" },
    { name: "Grailed", mode: "export" },
    { name: "Depop", mode: "export" },
  ],
};

const FLOW_TICKET: TicketItem = {
  lot: "Lot 0418 — Intake",
  art: "hoodie",
  title: "Supreme box logo hoodie — black, FW21",
  category: "Men → Sweats & Hoodies",
  size: "L",
  condition: "Excellent",
  measurements: "P2P 23″ · L 28″",
  price: "$185",
  confidence: 82,
  comps: [
    { source: "eBay", note: "06/30", price: "$184" },
    { source: "StockX", note: "06/21", price: "$172" },
    { source: "eBay", note: "07/05", price: "$205" },
  ],
  lanes: [
    { name: "eBay", mode: "publish" },
    { name: "StockX", mode: "publish" },
    { name: "Grailed", mode: "export" },
    { name: "Depop", mode: "export" },
  ],
  soldLine: "Sold on eBay — $185",
  soldFollowups: [
    "StockX — deactivated via API",
    "Grailed — flagged: mark sold",
    "Inventory — moved to Sold",
  ],
};

const FLOW_STEPS: FlowStep[] = [
  {
    id: "upload",
    title: "Upload the pile",
    blurb:
      "Raw phone shots — front, back, tags, flaws. No studio, no spreadsheet.",
  },
  {
    id: "draft",
    title: "Sello writes it",
    blurb:
      "Title, category, size, condition, measurements — drafted from the photos. You edit, you approve.",
  },
  {
    id: "price",
    title: "Priced on evidence",
    blurb:
      "Real sold comps, outliers trimmed, and a confidence score you can defend. Never an invented number.",
  },
  {
    id: "publish",
    title: "Publish or export listings",
    blurb:
      "eBay and StockX publish through official APIs where enabled. Grailed, Poshmark, and Depop get copy-ready packages you post yourself.",
  },
  {
    id: "sold",
    title: "Track it to sold",
    blurb:
      "One inventory — draft, live, sold, delisted. When something sells, Sello helps you delist supported connected channels. Inventory sync keeps every status honest.",
  },
];

type BoardCell = {
  name: string;
  tag: string;
  tone: "native" | "gated" | "copy";
  blurb: string;
  featured?: boolean;
  points?: string[];
};

const BOARD: BoardCell[] = [
  {
    name: "eBay",
    tag: "Native API",
    tone: "native",
    featured: true,
    blurb:
      "The deepest path. Official Sell API publishing — inventory, offers, and readiness checks against your actual seller policies.",
    points: [
      "No developer account — connect your normal eBay seller account",
      "Auto-publish needs standard seller policies — payment, shipping, and returns",
      "Sello checks readiness during onboarding",
    ],
  },
  {
    name: "StockX",
    tag: "Native API",
    tone: "native",
    featured: true,
    blurb:
      "Catalog-native. Exact catalog match, then create, activate, and deactivate listings through the official API.",
    points: [
      "Official StockX Public API",
      "Exact catalog match required",
      "You confirm every live action",
    ],
  },
  {
    name: "Etsy",
    tag: "Native · Gated",
    tone: "gated",
    blurb:
      "Live publishing is gated to selected accounts today. Copy-ready drafts are always available.",
  },
  {
    name: "TikTok Shop",
    tag: "Native · Gated",
    tone: "gated",
    blurb:
      "Product, price, and order sync once your seller shop is connected. Listings may need TikTok review before going live.",
  },
  {
    name: "Vinted",
    tag: "Gated",
    tone: "gated",
    blurb:
      "Autonomous listing and sync arrive once Vinted Pro API access is approved.",
  },
  {
    name: "Grailed",
    tag: "Copy-ready",
    tone: "copy",
    blurb:
      "Complete listing packages — title, designer, category, sizing, price, photo order. You post it yourself.",
  },
  {
    name: "Poshmark",
    tag: "Copy-ready",
    tone: "copy",
    blurb:
      "Copy-ready packages formatted for Poshmark. No botting, no share automation — your account stays yours.",
  },
  {
    name: "Depop",
    tag: "Copy-ready",
    tone: "copy",
    blurb: "Photo-first packages sized for Depop. Post in seconds, stay in control.",
  },
];

const COMP_TAPE = [
  { source: "eBay", date: "07/02", condition: "Excellent", price: "$310", median: false },
  { source: "eBay", date: "06/28", condition: "Excellent", price: "$295", median: true },
  { source: "Grailed", date: "06/19", condition: "Very good", price: "$270", median: false },
  { source: "eBay", date: "06/07", condition: "Good", price: "$248", median: false },
] as const;

const EVIDENCE_POINTS = [
  ["Sold evidence, not vibes", "Comps from real closes — confidence you can defend."],
  ["Refresh when it matters", "Re-run discovery so yesterday's price doesn't kill today's sale."],
  ["Built for volume", "Price a rack of inventory without living in browser tabs."],
] as const;

type PlanCol = {
  name: string;
  price: string;
  cadence: string;
  picked?: boolean;
  specs: string[];
};

const PLANS: PlanCol[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "early access",
    specs: [
      "10 AI listings / mo",
      "1 marketplace connection",
      "Pricing preview",
      "Limited comp credits",
    ],
  },
  {
    name: "Pro",
    price: "$20",
    cadence: "per month",
    picked: true,
    specs: [
      "125 AI listings / mo",
      "3 marketplace connections",
      "Full sold-comp pricing",
      "Templates + profit tracking",
    ],
  },
  {
    name: "Kingpin",
    price: "$119",
    cadence: "per month",
    specs: [
      "1,000 AI listings / mo",
      "5 marketplace connections",
      "Bulk tools — 250 a batch",
      "Auto-delist + sold detection · 5 seats",
    ],
  },
];

const FAQ = [
  [
    "Do I need an eBay developer account?",
    "No. Connect your normal eBay seller account and Sello handles the rest. For auto-publish, eBay needs standard seller policies — payment, shipping, and returns — and Sello checks those during onboarding so you are not guessing.",
  ],
  [
    "Can Sello publish to every marketplace?",
    "No — and it won't pretend to. eBay and StockX publish through official APIs where access and eligibility allow, with Etsy and TikTok Shop gated the same way. Grailed, Poshmark, and Depop use assisted listing packages you post yourself. No scraping, no botting.",
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
    <main className="lp">
      <span className="lp-nav-sentinel" aria-hidden="true" />

      <nav className="lp-nav" aria-label="Main">
        <div className="lp-nav__inner">
          <Link href="/" className="lp-nav__brand" aria-label="Sello home">
            Sello<em>.</em>
          </Link>
          <div className="lp-nav__links">
            <a href="#how-it-works">How it works</a>
            <a href="#marketplaces">Marketplaces</a>
            <a href="#plans">Plans</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-nav__actions">
            <Link href="/dashboard" className="lp-btn lp-btn--ghost lp-btn--sm">
              Sign in
            </Link>
            <Link href="/dashboard" className="lp-btn lp-btn--red lp-btn--sm">
              Start free
            </Link>
          </div>
        </div>
      </nav>

      <header className="lp-hero">
        <div className="lp-hero__meta">
          <span>Sello — Resale crosslisting</span>
          <span>Fig. 01 — For resellers</span>
          <span>Early access / 2026</span>
        </div>

        <div className="lp-hero__grid">
          <div className="lp-hero__copy">
            <h1 className="lp-hero__display">
              <span className="lp-hero__line">Photos in.</span>
              <span className="lp-hero__line">Listings that</span>
              <span className="lp-hero__line lp-hero__line--serif">
                sell themselves<em>.</em>
              </span>
            </h1>
            <p className="lp-hero__lede">
              Sello writes the listing from your photos, prices it from real
              sold comps, publishes to eBay and StockX through official APIs
              where enabled, and preps copy-ready packages for the rest — one
              inventory, synced where supported.
            </p>
            <div className="lp-hero__cta">
              <Link href="/dashboard" className="lp-btn lp-btn--red">
                Start creating listings
              </Link>
              <a href="#how-it-works" className="lp-btn lp-btn--line">
                See how it works
              </a>
            </div>
            <p className="lp-hero__fine">
              Free to start · no card · your accounts stay yours
            </p>
          </div>

          <div className="lp-hero__artifact">
            <LandingTicket item={HERO_TICKET} stage="complete" headline />
          </div>
        </div>
      </header>

      <section
        id="how-it-works"
        className="lp-section lp-section--flow"
        aria-labelledby="lp-flow-title"
      >
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-eyebrow">
            <span className="lp-eyebrow__fig">Fig. 02</span> The flow
          </p>
          <h2 id="lp-flow-title" className="lp-section__title">
            From photo to live to <em>sold.</em>
          </h2>
          <p className="lp-section__sub">
            One streamlined flow — upload, draft, price, publish or export,
            synced. No retyping, no tab-juggling.
          </p>
        </div>
        <LandingFlow steps={FLOW_STEPS} item={FLOW_TICKET} />
      </section>

      <section
        id="marketplaces"
        className="lp-section lp-section--board"
        aria-labelledby="lp-board-title"
      >
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-eyebrow">
            <span className="lp-eyebrow__fig">Fig. 03</span> Coverage
          </p>
          <h2 id="lp-board-title" className="lp-section__title">
            Eight channels. <em>Honest</em> support levels.
          </h2>
          <p className="lp-section__sub">
            No scraping, no botting, no pretending. Sello does the maximum
            each marketplace officially allows — and labels exactly what that
            is.
          </p>
        </div>

        <div className="lp-board">
          {BOARD.map((cell) => (
            <article
              key={cell.name}
              className={`lp-board__cell${cell.featured ? " lp-board__cell--featured" : ""}`}
              data-reveal="stamp"
            >
              <div className="lp-board__cell-head">
                <h3>{cell.name}</h3>
                <span className={`lp-chip lp-chip--${cell.tone}`}>{cell.tag}</span>
              </div>
              <p>{cell.blurb}</p>
              {cell.points ? (
                <ul className="lp-board__points">
                  {cell.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-section--evidence" aria-labelledby="lp-evidence-title">
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-eyebrow lp-eyebrow--onink">
            <span className="lp-eyebrow__fig">Fig. 04</span> Pricing evidence
          </p>
          <h2 id="lp-evidence-title" className="lp-section__title">
            Priced like the market <em>already did.</em>
          </h2>
          <p className="lp-section__sub">
            Sello hunts real sold comps, trims the outliers, and recommends a
            price from what buyers actually paid — with a confidence score and
            the receipts behind it. Create listings free and preview pricing;
            paid plans unlock full automatic discovery and refreshes, so your
            ask stays sharp as the market moves.
          </p>
        </div>

        <div className="lp-evidence">
          <figure className="lp-tape" data-reveal="rise">
            <figcaption className="lp-tape__caption">
              <span>Comp tape — wool overcoat · M</span>
              <span className="lp-chip lp-chip--onink">Illustrative</span>
            </figcaption>
            <table className="lp-tape__table">
              <thead>
                <tr>
                  <th scope="col">Sold</th>
                  <th scope="col">Date</th>
                  <th scope="col">Condition</th>
                  <th scope="col" className="lp-tape__num">
                    Close
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMP_TAPE.map((row) => (
                  <tr key={`${row.date}-${row.price}`} className={row.median ? "is-median" : ""}>
                    <td>{row.source}</td>
                    <td>{row.date}</td>
                    <td>{row.condition}</td>
                    <td className="lp-tape__num">{row.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="lp-tape__verdict">
              <div className="lp-tape__ask" data-reveal="stamp">
                <span>Suggested ask</span>
                <strong>$285</strong>
              </div>
              <div className="lp-tape__conf">
                <span
                  className="lp-tape__conf-bar"
                  role="img"
                  aria-label="Confidence 82 percent"
                >
                  <i style={{ width: "82%" }} />
                </span>
                <span>Confidence 82%</span>
              </div>
            </div>
            <p className="lp-tape__note">
              Illustrative example. Sello never invents comps — items without
              real sold data are marked “Needs comps.”
            </p>
          </figure>

          <ul className="lp-evidence__points">
            {EVIDENCE_POINTS.map(([title, body]) => (
              <li key={title} data-reveal="rise">
                <strong>{title}</strong>
                <span>{body}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="plans" className="lp-section lp-section--plans" aria-labelledby="lp-plans-title">
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-eyebrow">
            <span className="lp-eyebrow__fig">Fig. 05</span> Plans
          </p>
          <h2 id="lp-plans-title" className="lp-section__title">
            Free to list. <em>Paid</em> to price.
          </h2>
          <p className="lp-section__sub">
            Full sold-comp discovery uses paid provider calls — credit-limited,
            included with paid plans.
          </p>
        </div>

        <div className="lp-plans">
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`lp-plan${plan.picked ? " lp-plan--picked" : ""}`}
              data-reveal="rise"
            >
              {plan.picked ? <span className="lp-plan__flag">Most picked</span> : null}
              <div className="lp-plan__head">
                <h3>{plan.name}</h3>
                <p className="lp-plan__price">
                  <strong>{plan.price}</strong>
                  <span>{plan.cadence}</span>
                </p>
              </div>
              <ul className="lp-plan__specs">
                {plan.specs.map((spec) => (
                  <li key={spec}>{spec}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="lp-section__cta" data-reveal="rise">
          <Link href="/pricing" className="lp-btn lp-btn--line">
            View pricing
          </Link>
        </div>
      </section>

      <section id="faq" className="lp-section lp-section--faq" aria-labelledby="lp-faq-title">
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-eyebrow">
            <span className="lp-eyebrow__fig">Fig. 06</span> Questions
          </p>
          <h2 id="lp-faq-title" className="lp-section__title">
            Straight <em>answers.</em>
          </h2>
        </div>
        <div className="lp-faq">
          {FAQ.map(([question, answer], index) => (
            <details key={question} className="lp-faq__item" data-reveal="rise">
              <summary>
                <span className="lp-faq__n">{String(index + 1).padStart(2, "0")}</span>
                <span className="lp-faq__q">{question}</span>
                <span className="lp-faq__mark" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="lp-faq__a">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="lp-close">
        <div className="lp-close__inner">
          <p className="lp-close__display" data-reveal="rise">
            <span>Less listing work.</span>
            <span className="lp-close__serif">
              More selling<em>.</em>
            </span>
          </p>
          <p className="lp-close__sub" data-reveal="rise">
            Start free. Bring photos. Let Sello run the loop.
          </p>
          <div className="lp-close__cta" data-reveal="rise">
            <Link href="/dashboard" className="lp-btn lp-btn--red">
              Start creating listings
            </Link>
            <Link href="/pricing" className="lp-btn lp-btn--onink">
              View pricing
            </Link>
          </div>

          <div className="lp-close__meta">
            <span className="lp-close__brand">
              Sello<em>.</em>
            </span>
            <div className="lp-close__links">
              <span>© Sello 2026 — Early access</span>
              <Link href="/contact">Contact</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/pricing">Pricing</Link>
            </div>
          </div>
        </div>
      </footer>

      <LandingEffects />
    </main>
  );
}
