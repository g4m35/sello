import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sello — Turn clothing photos into resale listings",
  description:
    "Sello is an AI-native resale operating system for fashion sellers. Turn item photos into clean listings, sold-comp pricing guidance, and marketplace-ready drafts. Automated where supported. Assisted where required.",
  openGraph: {
    title: "Sello — Turn clothing photos into resale listings",
    description:
      "AI listing generation, sold-comp pricing guidance, and marketplace-ready drafts for fashion resellers. Automated where supported. Assisted where required.",
    type: "website",
  },
};

const PANEL: React.CSSProperties = {
  border: "1px solid #1f1f24",
  borderRadius: 14,
  background: "#0e0e11",
  padding: 20,
};

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ maxWidth: 1040, margin: "0 auto", padding: "48px 20px" }}>
      {title && (
        <h2 style={{ fontSize: 26, margin: "0 0 20px", letterSpacing: -0.4 }}>{title}</h2>
      )}
      {children}
    </section>
  );
}

export default function Landing() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#08080a",
        color: "#ededf2",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      {/* Hero */}
      <header style={{ maxWidth: 1040, margin: "0 auto", padding: "72px 20px 24px" }}>
        <div
          style={{
            display: "inline-block",
            fontSize: 12,
            color: "#9aa",
            border: "1px solid #23232a",
            borderRadius: 999,
            padding: "4px 12px",
            marginBottom: 22,
          }}
        >
          Early access · private alpha
        </div>
        <h1 style={{ fontSize: 48, lineHeight: 1.05, letterSpacing: -1, margin: "0 0 16px" }}>
          Turn clothing photos into resale listings.
        </h1>
        <p style={{ fontSize: 19, color: "#b6b6c0", maxWidth: 640, margin: "0 0 28px" }}>
          Sello writes clean listings, prepares marketplace-ready drafts, and helps
          price items with sold-comp intelligence. Automated where supported.
          Assisted where required.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/dashboard"
            style={{
              background: "#ededf2",
              color: "#08080a",
              padding: "12px 20px",
              borderRadius: 10,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Start creating listings
          </Link>
          <Link
            href="#how-it-works"
            style={{
              border: "1px solid #2a2a32",
              color: "#ededf2",
              padding: "12px 20px",
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            See how it works
          </Link>
        </div>
      </header>

      {/* Workflow */}
      <Section id="how-it-works" title="From photo to marketplace-ready">
        <ol
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {[
            ["1", "Upload photos", "Drop in raw item photos."],
            ["2", "Sello writes the listing", "Title, description, item specifics, measurements, and flaws."],
            ["3", "Review price & comps", "Sold-comp guidance with a confidence score."],
            ["4", "Publish or export", "Publish on eBay; export marketplace-ready packages elsewhere."],
            ["5", "Track inventory", "Status tracking across your channels."],
          ].map(([n, h, d]) => (
            <li key={n} style={PANEL}>
              <div style={{ color: "#8a8a96", fontSize: 13, marginBottom: 6 }}>Step {n}</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{h}</div>
              <div style={{ color: "#9a9aa6", fontSize: 14 }}>{d}</div>
            </li>
          ))}
        </ol>
        <p style={{ color: "#9a9aa6", marginTop: 16 }}>
          Sello removes the repetitive work: titles, descriptions, item specifics,
          measurements, flaws, marketplace formatting, pricing, and status tracking.
        </p>
      </Section>

      {/* Marketplaces */}
      <Section title="Marketplace support, honestly">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          <div style={PANEL}>
            <h3 style={{ margin: "0 0 8px" }}>eBay</h3>
            <p style={{ color: "#9a9aa6", margin: 0 }}>
              The deepest automation path, through eBay&apos;s official APIs.
            </p>
          </div>
          <div style={PANEL}>
            <h3 style={{ margin: "0 0 8px" }}>Grailed, Poshmark, Depop</h3>
            <p style={{ color: "#9a9aa6", margin: 0 }}>
              Marketplace-ready assisted listing packages and copy flows. You stay
              in control and post where direct publishing is not supported.
            </p>
          </div>
          <div style={PANEL}>
            <h3 style={{ margin: "0 0 8px" }}>Everywhere else</h3>
            <p style={{ color: "#9a9aa6", margin: 0 }}>
              Supported through export and copy workflows first.
            </p>
          </div>
        </div>
        <p style={{ color: "#cfcfd6", marginTop: 18, fontWeight: 600 }}>
          Automated where supported. Assisted where required.
        </p>
      </Section>

      {/* Auto-pricing */}
      <Section title="Sold-comp pricing intelligence">
        <div style={PANEL}>
          <p style={{ color: "#b6b6c0", marginTop: 0 }}>
            Sello uses sold-comp discovery and confidence scoring to back every
            price with real evidence.
          </p>
          <p style={{ color: "#9a9aa6", margin: 0 }}>
            Create listings for free and preview pricing. Paid plans unlock full
            automatic sold-comp discovery, confidence scoring, and refreshes. Full
            auto-pricing uses paid provider calls, so it is credit-limited and
            included with paid plans.
          </p>
        </div>
      </Section>

      {/* eBay setup FYI */}
      <Section title="Connecting eBay">
        <div style={PANEL}>
          <p style={{ color: "#b6b6c0", marginTop: 0 }}>
            You do not need an eBay developer account. Sello connects to your normal
            eBay seller account.
          </p>
          <p style={{ color: "#9a9aa6", margin: 0 }}>
            To auto-publish, eBay requires standard seller policies like payment,
            shipping, and returns. Sello checks this during onboarding.
          </p>
        </div>
      </Section>

      {/* Grailed assisted */}
      <Section title="Grailed-ready, assisted">
        <div style={PANEL}>
          <p style={{ color: "#9a9aa6", margin: 0 }}>
            For Grailed, Sello prepares a complete listing package: title, designer,
            category, size, description, measurements, price, photo order, and
            copy-ready fields. You stay in control when direct publishing is not
            supported.
          </p>
        </div>
      </Section>

      {/* Pricing preview */}
      <Section title="Early access pricing">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          {[
            ["Free / Trial", ["Create listings", "Basic pricing preview", "Limited auto-comp credits"]],
            ["Starter", ["Full auto-pricing", "Sold comps", "Confidence scores", "Refresh limits"]],
            ["Seller / Pro", ["More listings", "More comp credits", "Bulk tools (later)"]],
          ].map(([name, feats]) => (
            <div key={name as string} style={PANEL}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{name as string}</div>
              <div style={{ color: "#8a8a96", fontSize: 12, marginBottom: 10 }}>Coming soon</div>
              <ul style={{ color: "#9a9aa6", paddingLeft: 18, margin: 0 }}>
                {(feats as string[]).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p style={{ color: "#9a9aa6", marginTop: 14 }}>
          Free users can create listings and preview pricing. Paid plans unlock
          automatic sold-comp discovery, confidence scoring, and evidence-backed
          price recommendations.
        </p>
      </Section>

      {/* FAQ */}
      <Section title="FAQ">
        <div style={{ display: "grid", gap: 12 }}>
          {[
            ["Do I need an eBay developer account?", "No. Sello connects to your normal eBay seller account."],
            [
              "Can Sello publish directly to every marketplace?",
              "No — only where official support exists. eBay has the deepest path; others use assisted listing packages and exports.",
            ],
            [
              "Does Sello support Grailed?",
              "Yes, through Grailed-ready assisted listing packages. You post manually where direct publishing is not supported.",
            ],
            [
              "Why is full auto-pricing paid?",
              "It uses paid provider calls and sold-comp discovery, so it is credit-limited and included with paid plans.",
            ],
            [
              "Can I use Sello without eBay?",
              "Yes — for listing generation and assisted marketplace exports.",
            ],
            ["Is Sello in early access?", "Yes. Feedback directly shapes what gets built next."],
          ].map(([q, a]) => (
            <div key={q} style={PANEL}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{q}</div>
              <div style={{ color: "#9a9aa6" }}>{a}</div>
            </div>
          ))}
        </div>
      </Section>

      <footer
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          padding: "24px 20px 64px",
          color: "#6a6a76",
          fontSize: 13,
        }}
      >
        <Link href="/dashboard" style={{ color: "#cfcfd6" }}>
          Start creating listings
        </Link>{" "}
        · Sello is in early access.
      </footer>
    </main>
  );
}
