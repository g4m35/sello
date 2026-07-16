import type { Metadata } from "next";
import Link from "next/link";

import { PUBLIC_CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Contact | Sello",
  description: "Contact Sello about early access, support, and resale workflow questions.",
};

export default function ContactPage() {
  return (
    <main className="contact-page">
      <section className="contact-panel">
        <Link href="/" className="landing-brand" aria-label="Sello home">
          Sello<span>.</span>
        </Link>
        <div>
          <p className="contact-panel__eyebrow">Contact</p>
          <h1>Talk to Sello.</h1>
          <p>
            For early access, seller questions, support, or partnership notes,
            email the owner directly.
          </p>
        </div>
        <a className="landing-button landing-button--primary" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
          {PUBLIC_CONTACT_EMAIL}
        </a>
        <Link href="/" className="landing-button landing-button--secondary">
          Back to landing page
        </Link>
      </section>
    </main>
  );
}
