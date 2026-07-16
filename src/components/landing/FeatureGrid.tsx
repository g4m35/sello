import {
  BadgeDollarSign,
  Bot,
  Boxes,
  ClipboardCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

const capabilities = [
  {
    icon: <Bot size={17} />,
    title: "Automated listing drafts",
    copy: "Photos turn into titles, descriptions, categories, specifics, measurements, and tags.",
  },
  {
    icon: <BadgeDollarSign size={17} />,
    title: "Automated sold-comp pricing",
    copy: "Sello summarizes comp range, confidence, fees, and recommended list price.",
  },
  {
    icon: <ClipboardCheck size={17} />,
    title: "Marketplace-ready outputs",
    copy: "Fields, copy, and checks are shaped for each selected marketplace.",
  },
  {
    icon: <ShieldCheck size={17} />,
    title: "Seller approval gates",
    copy: "Drafts stay reviewable. Sello does not make a listing live without the right control.",
  },
  {
    icon: <Boxes size={17} />,
    title: "Inventory protection",
    copy: "Track every item across channels and reduce stale listing risk after a sale.",
  },
  {
    icon: <RefreshCw size={17} />,
    title: "Bulk resale workflow",
    copy: "Move batches from photos to listings without rebuilding the same work item by item.",
  },
];

export function FeatureGrid() {
  return (
    <section id="automation" className="landing-section feature-summary">
      <div className="feature-summary__intro">
        <h2>Sello is an automated listing system for resellers.</h2>
      </div>
      <div className="feature-summary__list">
        {capabilities.map((capability, index) => (
          <article key={capability.title} className="feature-summary__item">
            <span className="feature-summary__number">{String(index + 1).padStart(2, "0")}</span>
            <div className="feature-summary__icon">{capability.icon}</div>
            <div>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
