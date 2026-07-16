import Link from "next/link";

const navItems = [
  { href: "#demo", label: "Demo" },
  { href: "#automation", label: "Automation" },
  { href: "#marketplaces", label: "Marketplaces" },
  { href: "/contact", label: "Contact" },
];

export function LandingNav() {
  return (
    <header className="landing-nav-wrap">
      <nav className="landing-nav" aria-label="Main">
        <Link href="/" className="landing-brand" aria-label="Sello home">
          Sello<span>.</span>
        </Link>
        <div className="landing-nav__links">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
