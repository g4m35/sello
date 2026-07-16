import type { Metadata } from "next";
import Link from "next/link";

import { PUBLIC_CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Contact | Sello",
  description: "Contact Sello about early access, support, and resale workflow questions.",
};

export default function ContactPage() {
  return (
    <main className="lp-contact">
      <section className="lp-contact__panel">
        <Link href="/" className="lp-contact__brand" aria-label="Sello home">
          Sello<em>.</em>
        </Link>
        <div>
          <p className="lp-contact__eyebrow">Contact</p>
          <h1>Talk to Sello.</h1>
          <p>
            For early access, seller questions, support, or partnership notes,
            email the owner directly.
          </p>
        </div>
        <div className="lp-contact__actions">
          <a className="lp-btn lp-btn--red" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
            {PUBLIC_CONTACT_EMAIL}
          </a>
          <Link href="/" className="lp-btn lp-btn--line">
            Back to landing page
          </Link>
        </div>
      </section>
    </main>
  );
}
