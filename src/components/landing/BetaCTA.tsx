import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function BetaCTA() {
  return (
    <section className="landing-section beta-cta">
      <div>
        <h2>Built for sellers moving real inventory.</h2>
        <p>
          Sello is opening access to early sellers who want faster listing,
          better pricing, and cleaner inventory control across marketplaces.
        </p>
      </div>
      <div className="beta-cta__actions">
        <Link href="/dashboard" className="landing-button landing-button--primary">
          Request access
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
