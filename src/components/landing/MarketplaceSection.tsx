const marketplaceCards = [
  {
    name: "eBay",
    status: "Direct workflow",
    copy: "Draft, readiness checks, seller approval, and publishing where account setup allows.",
    featured: true,
  },
  {
    name: "StockX",
    status: "Variant review",
    copy: "Product matching, size checks, and review before listing.",
  },
  {
    name: "Grailed",
    status: "Optimized copy",
    copy: "Designer-aware copy and item details ready for seller review.",
  },
  {
    name: "Depop",
    status: "Copy ready",
    copy: "Fast mobile-friendly copy and inventory tracking.",
  },
  {
    name: "Poshmark",
    status: "Inventory tracking",
    copy: "Listing copy and channel tracking for resale inventory.",
  },
];

export function MarketplaceSection() {
  return (
    <section id="marketplaces" className="landing-section marketplace-section">
      <div className="landing-section__head">
        <h2>Marketplaces are selected before Sello builds the listing.</h2>
        <p>
          Sello uses the deepest available workflow for each marketplace: direct
          publishing only where technically and policy-wise available, guided
          listing where platform limits require review. More marketplaces are
          coming.
        </p>
      </div>
      <div className="marketplace-showcase" aria-label="Marketplace workflows">
        {marketplaceCards.map((marketplace) => (
          <article
            key={marketplace.name}
            className={
              marketplace.featured
                ? "marketplace-card marketplace-card--featured"
                : "marketplace-card"
            }
          >
            <span>{marketplace.name.slice(0, 1)}</span>
            <div>
              <p>{marketplace.status}</p>
              <h3>{marketplace.name}</h3>
              <strong>{marketplace.copy}</strong>
            </div>
          </article>
        ))}
        <article className="marketplace-card marketplace-card--coming-soon">
          <span>+</span>
          <div>
            <p>More coming</p>
            <h3>Vinted, TikTok Shop, and more</h3>
            <strong>New channels will be added as Sello expands seller workflows.</strong>
          </div>
        </article>
      </div>
    </section>
  );
}
