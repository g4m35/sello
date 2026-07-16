const faqs = [
  [
    "Does Sello publish directly to marketplaces?",
    "Sello uses the deepest available workflow for each marketplace. Some platforms support direct publishing, while others require guided or copy-ready listing flows.",
  ],
  [
    "Does Sello support eBay?",
    "Yes. Sello includes eBay-focused publishing readiness, listing validation, and seller setup checks.",
  ],
  [
    "Does Sello support StockX, Grailed, Depop, Poshmark, Vinted, and TikTok Shop?",
    "These marketplaces are supported workflow targets, with direct publishing only where technically and policy-wise available.",
  ],
  [
    "Can Sello bulk upload items?",
    "Bulk upload is a core workflow: upload many items, generate listings, review, then publish or export.",
  ],
  [
    "Does Sello automatically delist sold items?",
    "Sello positions this as inventory protection: it tracks where an item is listed and helps remove or flag stale listings after sale events.",
  ],
];

export function FAQ() {
  return (
    <section id="faq" className="landing-section faq-section">
      <div className="landing-section__head">
        <h2>FAQ</h2>
      </div>
      <div className="faq-list">
        {faqs.map(([question, answer]) => (
          <details key={question} className="faq-item">
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
