import Link from "next/link";

import { LandingEffects } from "@/components/marketing/landing-effects";
import { LandingFlow, type FlowStep } from "@/components/marketing/landing-flow";
import { LandingTicket, type TicketItem } from "@/components/marketing/landing-ticket";
import { PLAN_CATALOG, type PlanId } from "@/lib/billing/plans";

const HERO_TICKET: TicketItem = {
  lot: "LOT 0417 / SOLD",
  art: "coat",
  title: "Wool overcoat, charcoal",
  brand: "Acne Studios",
  category: "Men / Coats & Jackets",
  size: "M",
  condition: "Excellent · A-",
  measurements: "P2P 21½ in · L 38 in",
  flaw: "Light cuff wear disclosed",
  attributes: "Wool · charcoal · single-breasted",
  price: "$285–$310",
  quickSale: "$265",
  confidence: 82,
  readiness: ["Required fields", "Photo order", "Seller policies"],
  comps: [
    { source: "eBay", note: "07/02", price: "$310" },
    { source: "eBay", note: "06/28", price: "$295" },
  ],
  lanes: [
    { name: "eBay", tier: "direct", state: "sold", note: "Sale detected · $285" },
    { name: "StockX", tier: "direct", state: "delisted", note: "Deactivated via API" },
    { name: "Grailed", tier: "guided", state: "review", note: "Mark sold action ready" },
  ],
  audit: [
    "SALE DETECTED · EBAY",
    "STOCKX · DEACTIVATED VIA API",
    "GRAILED · FLAGGED: MARK SOLD",
    "INVENTORY · RESOLVED: SOLD",
  ],
};

const CREATION_TICKET: TicketItem = {
  lot: "LOT 0418 / GENERATED",
  art: "hoodie",
  title: "Box logo hoodie, black, FW21",
  brand: "Supreme",
  category: "Men / Sweats & Hoodies",
  size: "L",
  condition: "Excellent · A",
  measurements: "P2P 23 in · L 28 in",
  flaw: "No visible flaws",
  attributes: "Cotton fleece · black · pullover",
  price: "$180–$205",
  quickSale: "$170",
  confidence: 86,
  readiness: ["Brand confirmed", "Condition complete", "Item specifics mapped"],
  comps: [
    { source: "eBay", note: "06/30", price: "$184" },
    { source: "StockX", note: "06/21", price: "$172" },
  ],
  lanes: [
    { name: "eBay", tier: "direct", state: "pending", note: "Ready after review" },
    { name: "Grailed", tier: "guided", state: "pending", note: "Final post staged" },
  ],
};

const LIFECYCLE_STEPS: FlowStep[] = [
  { id: "intake", title: "Intake", caption: "Photos, tags, measurements, flaws." },
  { id: "generated", title: "Generated", caption: "Complete listing fields assembled." },
  { id: "priced", title: "Priced", caption: "Real sold comps set the range." },
  { id: "published", title: "Published", caption: "Best available workflow per channel." },
  { id: "live", title: "Live", caption: "Connection and listing states stay visible." },
  { id: "sale-detected", title: "Sale detected", caption: "The sold event enters the record." },
  { id: "delisted", title: "Delisted elsewhere", caption: "Linked listings resolve or queue review." },
  { id: "sold", title: "Sold & archived", caption: "History remains attached to the item." },
];

const CREATION_EVIDENCE = [
  ["Title", "Brand, model, color, season"],
  ["Condition", "Grade, flaws, disclosed wear"],
  ["Measurements", "Seller-entered and photo-supported"],
  ["Item specifics", "Correct fields for each marketplace"],
  ["Readiness", "Missing requirements stop the publish"],
] as const;

const MARKETPLACE_GROUPS = [
  {
    tier: "Publishes direct",
    tone: "direct",
    summary: "Official marketplace APIs carry the listing when the account and item are eligible.",
    rows: [
      ["eBay", "Sell API · live for selected accounts", "Connect your normal eBay seller account. Payment, shipping, and returns policies must be ready."],
      ["StockX", "Public API · exact catalog match", "Create, activate, and deactivate after a confirmed catalog match."],
      ["Etsy", "Native API, access-gated", "Direct publishing and sync activate for approved connected shops."],
      ["TikTok Shop", "Native API, access-gated", "Shop connection, required product fields, and TikTok review may apply."],
    ],
  },
  {
    tier: "Guided publish",
    tone: "guided",
    summary: "No official APIs exist for listing submission on these channels.",
    rows: [
      ["Grailed", "Complete listing · final post guided", "Sello formats the fields and stages photos in order. You perform the last action."],
      ["Poshmark", "Complete listing · final post guided", "Marketplace-specific fields are prepared, including the later mark not for sale action."],
      ["Depop", "Complete listing · final post guided", "The photo-first listing is assembled and checked before you post."],
    ],
  },
  {
    tier: "On approval",
    tone: "approval",
    summary: "The product path is built, but live access has not cleared.",
    rows: [
      ["Vinted", "Pending Vinted Pro API", "Direct publishing, sync, and sold events ship after API approval. Until then, capabilities fail closed."],
    ],
  },
] as const;

const BULK_ROWS = [
  ["LOT 0521", "Arc’teryx shell", "generated", "priced", "published"],
  ["LOT 0522", "Nike SB Dunk Low", "generated", "priced", "published"],
  ["LOT 0523", "Kapital knit", "generated", "priced", "published"],
  ["LOT 0524", "Carhartt Detroit jacket", "generated", "priced", "published"],
  ["LOT 0525", "Stone Island overshirt", "generated", "priced", "published"],
] as const;

const COMP_TAPE = [
  { source: "eBay", date: "07/02", condition: "Excellent", price: "$310", median: false },
  { source: "eBay", date: "06/28", condition: "Excellent", price: "$295", median: true },
  { source: "Grailed", date: "06/19", condition: "Very good", price: "$270", median: false },
  { source: "eBay", date: "06/07", condition: "Good", price: "$248", median: false },
] as const;

const COVERAGE_ROWS = [
  ["eBay", "Publishes direct", "Sell API", "Full sync on Kingpin", "Sale detection on Kingpin", "live"],
  ["StockX", "Publishes direct", "Catalog match", "Full sync on Kingpin", "Sold state on Kingpin", "live"],
  ["Etsy", "Publishes direct", "Native API, access-gated", "When access is active", "When access is active", "gated"],
  ["TikTok Shop", "Publishes direct", "Native API, access-gated", "When shop is connected", "Webhook when connected", "gated"],
  ["Grailed", "Guided publish", "Final post guided", "Linked item status", "Assisted sold-delist on Pro", "guided"],
  ["Poshmark", "Guided publish", "Final post guided", "Linked item status", "Mark not for sale guided", "guided"],
  ["Depop", "Guided publish", "Final post guided", "Linked item status", "Assisted sold-delist on Pro", "guided"],
  ["Vinted", "On approval", "Pending Vinted Pro API", "Planned after approval", "Planned after approval", "planned"],
] as const;

const OPERATING_COMPARISON = [
  ["Listing data", "Re-enter fields and fix gaps", "Marketplace-specific item data"],
  ["Publishing", "Repeat the posting loop", "Direct or guided by capability"],
  ["Connection health", "Discover expiry after a miss", "Connection status stays visible"],
  ["Sold elsewhere", "Check each channel again", "Sale detection pairs with delist work"],
  ["Partial failure", "Silent until you notice", "Per-item state, receipts, and retry"],
  ["Bulk work", "One bad row blocks attention", "Failure stays isolated to its item"],
] as const;

const TRUST_POINTS = [
  ["Readiness before publish", "Required fields, account policies, catalog matches, and channel eligibility are checked before a live action."],
  ["Duplicate-publish protection", "Idempotent operations prevent the same item action from being submitted twice."],
  ["Fail-closed capabilities", "If a connection, permission, or adapter is not ready, Sello stops instead of pretending it worked."],
  ["Retry and recovery", "Failed work keeps a visible state, a reason, and a path back to ready."],
  ["Review before live", "The seller approves the listing and confirms sensitive marketplace actions."],
  ["Secure marketplace auth", "OAuth connections keep credentials with the marketplace. No password sharing and no bots."],
] as const;

const PLAN_PRESENTATION: Array<{
  id: PlanId;
  cadence: string;
  featured?: boolean;
  features: string[];
}> = [
  {
    id: "free",
    cadence: "forever",
    features: ["Automation included", "Review before live"],
  },
  {
    id: "pro",
    cadence: "per month",
    featured: true,
    features: ["Basic analytics", "Simple profit tracking", "Templates", "Assisted sold-delist"],
  },
  {
    id: "kingpin",
    cadence: "per month",
    features: [
      "Full inventory sync",
      "Sold detection and automatic delisting",
      "Advanced comps, analytics, and profit tracking",
      "Repricing, dead stock, and performance analytics",
      "Priority queue and support",
    ],
  },
];

function formatLimit(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function LandingPage() {
  return (
    <main className="lp">
      <span className="lp-nav-sentinel" aria-hidden="true" />

      <nav id="nav" className="lp-nav" aria-label="Main">
        <div className="lp-nav__inner">
          <Link href="/" className="lp-nav__brand" aria-label="Sello home">
            Sello<em>.</em>
          </Link>
          <div className="lp-nav__links">
            <a href="#how-it-works">How it works</a>
            <a href="#marketplaces">Marketplaces</a>
            <a href="#inventory-sync">Inventory sync</a>
            <a href="#plans">Pricing</a>
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

      <header id="hero" className="lp-hero">
        <div className="lp-hero__meta">
          <span>Resale operating system / Early access</span>
          <span>One item record · every marketplace state</span>
        </div>
        <div className="lp-hero__grid">
          <div className="lp-hero__copy">
            <h1 className="lp-hero__display">
              <span>Photos in.</span>
              <span>Listings live.</span>
              <span className="lp-serif">Synchronized until sold<em>.</em></span>
            </h1>
            <p className="lp-hero__lede">
              Sello turns photos into complete listings, publishes through the strongest workflow each marketplace allows, and monitors supported connected channels through the sale.
            </p>
            <div className="lp-hero__cta">
              <Link href="/dashboard" className="lp-btn lp-btn--red">
                Start creating listings
              </Link>
              <a href="#how-it-works" className="lp-btn lp-btn--line">
                See how it works
              </a>
            </div>
            <p className="lp-hero__fine">Free to start · no card · your accounts stay yours</p>
          </div>
          <div className="lp-hero__artifact" data-sequence="hero" data-reveal="ticket">
            <LandingTicket item={HERO_TICKET} stage="sold" headline />
          </div>
        </div>
      </header>

      <section id="how-it-works" className="lp-section lp-section--loop" aria-labelledby="loop-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">01 / The loop</p>
            <h2 id="loop-title" className="lp-section__title">
              The listing is only <em>the first step.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            Follow one item from intake to sold and archived. Each state remains visible, attributable, and recoverable.
          </p>
        </div>
        <LandingFlow steps={LIFECYCLE_STEPS} item={HERO_TICKET} />
      </section>

      <section id="listing-creation" className="lp-section lp-section--creation" aria-labelledby="creation-title">
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-kicker">02 / Listing creation</p>
          <h2 id="creation-title" className="lp-section__title">
            From photos to {"a "}<em>complete listing.</em>
          </h2>
          <p className="lp-section__sub">
            AI creates the work. Readiness checks stop bad work from going live. You review before anything publishes.
          </p>
        </div>
        <div className="lp-anatomy">
          <div className="lp-anatomy__evidence">
            <div className="lp-anatomy__photos" aria-label="Photo evidence strip">
              <span data-photo="front">Front</span>
              <span data-photo="back">Back</span>
              <span data-photo="tag">Tag</span>
              <span data-photo="flaw">Flaw</span>
            </div>
            <p className="lp-anatomy__note">Raw phone photos · seller measurements · visible condition</p>
            <ol className="lp-anatomy__map">
              {CREATION_EVIDENCE.map(([field, evidence]) => (
                <li key={field}>
                  <span>{field}</span>
                  <strong>{evidence}</strong>
                </li>
              ))}
            </ol>
          </div>
          <div className="lp-anatomy__record" data-reveal="ticket">
            <LandingTicket item={CREATION_TICKET} stage="generated" />
          </div>
        </div>
      </section>

      <section id="marketplaces" className="lp-section lp-section--marketplaces" aria-labelledby="marketplaces-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">03 / Marketplace publishing</p>
            <h2 id="marketplaces-title" className="lp-section__title">
              The strongest workflow each marketplace <em>allows.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            No scraping. No botting. Your accounts stay yours. Sello says exactly what is direct, what is guided, and what is waiting on approval.
          </p>
        </div>
        <div className="lp-marketplace-groups">
          {MARKETPLACE_GROUPS.map((group) => (
            <article key={group.tier} className={`lp-marketplace-group lp-marketplace-group--${group.tone}`} data-reveal="table">
              <header>
                <span className={`lp-chip lp-chip--${group.tone}`}>{group.tier}</span>
                <p>{group.summary}</p>
              </header>
              <div className="lp-marketplace-group__rows">
                {group.rows.map(([name, mechanism, detail]) => (
                  <div key={name} className="lp-marketplace-row">
                    <h3>{name}</h3>
                    <strong>{mechanism}</strong>
                    <p>{detail}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="inventory-sync" className="lp-section lp-section--sync" aria-labelledby="sync-title">
        <div className="lp-sync" data-sequence="sync">
          <div className="lp-section__head lp-section__head--split" data-reveal="rise">
            <div>
              <p className="lp-kicker">04 / Inventory sync</p>
              <h2 id="sync-title" className="lp-section__title">
                After you publish is where <em>Sello earns it.</em>
              </h2>
            </div>
            <p className="lp-sync__statement">One sale. One inventory truth.</p>
          </div>
          <div className="lp-sync__board">
            <span className="lp-sync__event-line" aria-hidden="true" />
            <div className="lp-sync__record" data-reveal="ticket">
              <LandingTicket item={HERO_TICKET} stage="sold" />
            </div>
            <div className="lp-sync__control" data-reveal="table">
              <div className="lp-sync__legend" aria-label="Inventory state vocabulary">
                {(["active", "pending", "failed", "sold", "delisted", "review"] as const).map((state) => (
                  <span key={state} className={`lp-status lp-status--${state}`} data-state={state}>{state}</span>
                ))}
              </div>
              <ol className="lp-audit-tape" aria-label="Illustrative inventory event history">
                {HERO_TICKET.audit?.map((event, index) => (
                  <li key={event} data-audit-line={String(index + 1).padStart(2, "0")}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{event}</strong>
                  </li>
                ))}
              </ol>
              <div className="lp-sync__safety">
                <p>No silent failures.</p>
                <ul>
                  <li>Linked listings keep a visible marketplace state.</li>
                  <li>Exceptions surface for review before they become a second order.</li>
                  <li>Failed delist work keeps its reason, retry, and notification history.</li>
                </ul>
              </div>
            </div>
          </div>
          <p className="lp-sync__tier-note">
            Pro includes assisted sold-delist. Kingpin adds full inventory sync, sold detection, and automatic delisting.
          </p>
        </div>
      </section>

      <section id="bulk-operations" className="lp-section lp-section--bulk" aria-labelledby="bulk-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">05 / Bulk operations</p>
            <h2 id="bulk-title" className="lp-section__title">
              A rack, <em>not an item.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            Generate, price, publish, and recover a batch without letting one bad row hide the rest of the work.
          </p>
        </div>
        <div className="lp-manifest" data-sequence="bulk" data-reveal="table">
          <div className="lp-manifest__head">
            <span>Batch 072 / 5 items</span>
            <span>Per-item failure isolation · receipts attached</span>
          </div>
          <div className="lp-manifest__columns" aria-hidden="true">
            <span>Lot / item</span><span>Generated</span><span>Priced</span><span>Publish</span>
          </div>
          {BULK_ROWS.map(([lot, item, generated, priced, publish], index) => (
            <div
              key={lot}
              className="lp-manifest__row"
              data-batch-state={publish}
              data-manifest-row={index + 1}
              data-recovery-row={lot === "LOT 0523" ? "true" : undefined}
            >
              <span className="lp-manifest__item"><strong>{lot}</strong>{item}</span>
              <span className={`lp-manifest__state is-${generated}`} data-manifest-stage="generated">{generated}</span>
              <span className={`lp-manifest__state is-${priced}`} data-manifest-stage="priced">{priced}</span>
              <span className={`lp-manifest__state is-${publish}`} data-manifest-stage="published">{publish}</span>
            </div>
          ))}
          <div className="lp-manifest__progress" data-batch-count="5">5 / 5 published · 1 recovered</div>
          <div className="lp-manifest__limits">
            <span>Free · 5 items per batch</span>
            <span>Pro · 25 items per batch</span>
            <span>Kingpin · 250 items per batch</span>
          </div>
        </div>
      </section>

      <section id="pricing-intelligence" className="lp-section lp-section--pricing" aria-labelledby="pricing-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">06 / Pricing intelligence</p>
            <h2 id="pricing-title" className="lp-section__title">
              Priced like the market <em>already did.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            Real sold comps, trimmed outliers, confidence, and separate quick-sale and list ranges. If the evidence is weak, the item says Needs comps.
          </p>
        </div>
        <div className="lp-pricing-grid">
          <figure className="lp-tape" data-reveal="table">
            <figcaption className="lp-tape__caption">
              <span>Comp tape / wool overcoat / M</span>
              <span className="lp-chip lp-chip--paper">Illustrative</span>
            </figcaption>
            <table className="lp-tape__table">
              <thead><tr><th scope="col">Sold</th><th scope="col">Date</th><th scope="col">Condition</th><th scope="col">Close</th></tr></thead>
              <tbody>
                {COMP_TAPE.map((row) => (
                  <tr key={`${row.source}-${row.date}-${row.price}`} className={row.median ? "is-median" : ""}>
                    <td>{row.source}</td><td>{row.date}</td><td>{row.condition}</td><td>{row.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="lp-tape__verdict">
              <p><span>Quick sale</span><strong>$265</strong></p>
              <p><span>List range</span><strong>$285–$310</strong></p>
              <p><span>Confidence</span><strong>82%</strong></p>
            </div>
            <p className="lp-tape__note">Comp refreshes per month: Free 10 · Pro 100 · Kingpin 750.</p>
          </figure>
          <div className="lp-pricing-proof">
            <ul>
              <li><strong>Sold evidence</strong><span>Close prices, source, date, and condition stay attached.</span></li>
              <li><strong>Outlier control</strong><span>Bad matches do not silently pull the range.</span></li>
              <li><strong>Refresh depth</strong><span>Plan limits scale with inventory volume and repricing needs.</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section id="marketplace-coverage" className="lp-section lp-section--coverage" aria-labelledby="coverage-title">
        <div className="lp-section__head" data-reveal="rise">
          <p className="lp-kicker">07 / Marketplace coverage</p>
          <h2 id="coverage-title" className="lp-section__title">
            Eight channels. <em>Three honest lanes.</em>
          </h2>
        </div>
        <div className="lp-table-wrap" data-reveal="table">
          <table className="lp-coverage-table">
            <thead><tr><th scope="col">Channel</th><th scope="col">Lane</th><th scope="col">Mechanism</th><th scope="col">Sync</th><th scope="col">Sold handling</th></tr></thead>
            <tbody>
              {COVERAGE_ROWS.map(([channel, tier, mechanism, sync, sold, state]) => (
                <tr key={channel} data-coverage-state={state}>
                  <th scope="row">{channel}</th>
                  <td><span className={`lp-chip lp-chip--${state}`}>{tier}</span></td>
                  <td>{mechanism}</td><td>{sync}</td><td>{sold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="why-sello" className="lp-section lp-section--difference" aria-labelledby="difference-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">08 / Operating difference</p>
            <h2 id="difference-title" className="lp-section__title">
              Cross-listers copy. <em>Sello operates.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            The difference is not marketplace count. It is what happens after the fields are generated and before a failure becomes your problem.
          </p>
        </div>
        <p className="lp-difference__quote" data-reveal="rise">
          Not copied fields. Correct marketplace data.
        </p>
        <div className="lp-compare" data-reveal="table">
          <div className="lp-compare__head"><span>Operational dimension</span><span>Typical crosslister loop</span><span>Sello loop</span></div>
          {OPERATING_COMPARISON.map(([dimension, typical, sello]) => (
            <div key={dimension} className="lp-compare__row">
              <strong>{dimension}</strong><span>{typical}</span><span>{sello}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="trust" className="lp-section lp-section--trust" aria-labelledby="trust-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">09 / Operational safety</p>
            <h2 id="trust-title" className="lp-section__title">
              Trust is a <em>visible state.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            Every publish, connection, sale, delist, exception, and retry leaves a status the seller can inspect.
          </p>
        </div>
        <div className="lp-trust-list" data-reveal="table">
          {TRUST_POINTS.map(([title, body], index) => (
            <article key={title} className="lp-trust-item">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="plans" className="lp-section lp-section--plans" aria-labelledby="plans-title">
        <div className="lp-section__head lp-section__head--split" data-reveal="rise">
          <div>
            <p className="lp-kicker">10 / Plans</p>
            <h2 id="plans-title" className="lp-section__title">
              Automation starts free. <em>Depth scales.</em>
            </h2>
          </div>
          <p className="lp-section__sub">
            Every plan includes auto-publishing. Higher tiers add volume, connections, team capacity, and deeper sold-state automation.
          </p>
        </div>
        <div className="lp-plans" data-reveal="table">
          {PLAN_PRESENTATION.map(({ id, cadence, featured, features }) => {
            const plan = PLAN_CATALOG[id];
            return (
              <article key={id} className={`lp-plan${featured ? " lp-plan--featured" : ""}`}>
                {featured ? <span className="lp-plan__flag">Most picked</span> : null}
                <div className="lp-plan__head">
                  <h3>{plan.name}</h3>
                  <p className="lp-plan__price"><strong>${plan.priceCents / 100}</strong><span>{cadence}</span></p>
                </div>
                <ul className="lp-plan__limits">
                  <li><strong>{formatLimit(plan.limits.aiListingsPerMonth)}</strong><span>AI listings / mo</span></li>
                  <li><strong>{formatLimit(plan.limits.autopublishesPerMonth)}</strong><span>auto-publishes / mo</span></li>
                  <li><strong>{formatLimit(plan.limits.compRefreshesPerMonth)}</strong><span>comp refreshes / mo</span></li>
                  <li><strong>{plan.limits.marketplaceConnections}</strong><span>marketplace connections</span></li>
                  <li><strong>{plan.limits.bulkBatchSize}</strong><span>items per batch</span></li>
                  <li><strong>{plan.limits.teamSeats}</strong><span>{plan.limits.teamSeats === 1 ? "seat" : "seats"}</span></li>
                </ul>
                <ul className="lp-plan__features">
                  {features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <Link
                  href={id === "free" ? "/dashboard" : "/pricing"}
                  className={featured ? "lp-btn lp-btn--red" : "lp-btn lp-btn--line"}
                >
                  {id === "free" ? "Start free" : "View pricing"}
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section id="final-cta" className="lp-close" aria-labelledby="close-title">
        <div className="lp-close__inner">
          <div className="lp-close__art" aria-hidden="true"><span>LOT 0417</span><span>SOLD / SYNCED</span></div>
          <p className="lp-kicker">The loop closes here</p>
          <h2 id="close-title" className="lp-close__display">
            <span>Less listing work.</span>
            <span className="lp-serif">More selling<em>.</em></span>
          </h2>
          <p className="lp-close__sub">List it once. Sello handles the rest of its life.</p>
          <div className="lp-close__cta">
            <Link href="/dashboard" className="lp-btn lp-btn--red">Start creating listings</Link>
            <Link href="/pricing" className="lp-btn lp-btn--onink">View pricing</Link>
          </div>
        </div>
      </section>

      <footer id="footer" className="lp-footer">
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <Link href="/" aria-label="Sello home">Sello<em>.</em></Link>
            <p>One item record, every marketplace state.</p>
          </div>
          <div className="lp-footer__group">
            <strong>Product</strong>
            <a href="#how-it-works">How it works</a>
            <a href="#marketplaces">Marketplaces</a>
            <a href="#inventory-sync">Inventory sync</a>
            <Link href="/pricing">Plans</Link>
          </div>
          <div className="lp-footer__group">
            <strong>Company</strong>
            <Link href="/contact">Contact</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/dashboard">Sign in</Link>
          </div>
          <p className="lp-footer__legal">© Sello 2026 — Early access</p>
        </div>
      </footer>

      <LandingEffects />
    </main>
  );
}
