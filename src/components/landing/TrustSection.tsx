import { CheckCircle2 } from "lucide-react";

const trustItems = [
  "Seller approval before publish",
  "Platform-specific validation",
  "Price confidence controls",
  "Inventory status tracking",
  "Fail-safe marketplace actions",
  "Usage and cost controls",
];

export function TrustSection() {
  return (
    <section id="proof" className="landing-section trust-section">
      <div className="trust-section__panel">
        <div className="landing-section__head">
          <h2>Built with seller control, platform safety, and marketplace-specific workflows from day one.</h2>
          <p>
            Sello does not fake capability. Marketplace actions stay guarded by
            seller approval gates, readiness checks, and cost controls.
          </p>
        </div>
        <div className="trust-grid">
          {trustItems.map((item) => (
            <div key={item} className="trust-item">
              <CheckCircle2 size={16} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
