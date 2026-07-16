import { BadgeDollarSign, Bot, Send, ShieldCheck } from "lucide-react";

const pillars = [
  {
    icon: <Bot size={19} />,
    title: "AI listing generation",
    copy: "Upload photos. Sello builds the listing.",
  },
  {
    icon: <BadgeDollarSign size={19} />,
    title: "Smarter pricing",
    copy: "Compare sold comps, estimate list price, and adjust by marketplace.",
  },
  {
    icon: <Send size={19} />,
    title: "Marketplace publishing",
    copy: "Publish where APIs allow. Copy-ready flows where platforms require manual review.",
  },
  {
    icon: <ShieldCheck size={19} />,
    title: "Inventory control",
    copy: "Track where each item is listed and prevent stale listings after a sale.",
  },
];

export function SolutionSection() {
  return (
    <section className="landing-section landing-section--split">
      <div className="landing-section__head landing-section__head--sticky">
        <h2>One listing system for the whole resale workflow.</h2>
        <p>
          Sello connects the work sellers already do: listing generation, price
          confidence, marketplace workflow, and inventory protection.
        </p>
      </div>
      <div className="solution-stack">
        {pillars.map((pillar, index) => (
          <article key={pillar.title} className="solution-row">
            <span className="solution-row__number">{String(index + 1).padStart(2, "0")}</span>
            <div className="solution-row__icon">{pillar.icon}</div>
            <div>
              <h3>{pillar.title}</h3>
              <p>{pillar.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
