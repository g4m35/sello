import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function Hero() {
  return (
    <section className="landing-hero">
      <div className="landing-hero__copy">
        <h1>List everywhere. Sell faster. Stay in control.</h1>
        <div className="landing-hero__actions">
          <Link href="/dashboard" className="landing-button landing-button--primary">
            Start listing
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
