import Link from "next/link";

import { PUBLIC_CONTACT_EMAIL } from "@/lib/contact";

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <Link href="/" className="landing-brand">
        Sello<span>.</span>
      </Link>
      <nav aria-label="Footer">
        <Link href="/pricing">Pricing</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/dashboard">Start listing</Link>
      </nav>
      <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a>
    </footer>
  );
}
