import { AlertTriangle, Boxes, ClipboardList, Search } from "lucide-react";

const problems = [
  {
    icon: <ClipboardList size={18} />,
    title: "Photos become manual work",
    copy: "Titles, descriptions, measurements, condition notes, and tags are recreated every time.",
  },
  {
    icon: <Search size={18} />,
    title: "Pricing is scattered",
    copy: "Sellers jump between sold comps, marketplace searches, and gut guesses.",
  },
  {
    icon: <Boxes size={18} />,
    title: "Cross-listing breaks inventory",
    copy: "One sale can leave stale listings live elsewhere.",
  },
  {
    icon: <AlertTriangle size={18} />,
    title: "Every marketplace wants different details",
    copy: "eBay, StockX, Grailed, Depop, Poshmark, Vinted, and TikTok Shop all have different listing requirements.",
  },
];

export function ProblemSection() {
  return (
    <section className="landing-section">
      <div className="landing-section__head">
        <h2>Resellers lose hours before the item is even listed.</h2>
      </div>
      <div className="landing-card-grid landing-card-grid--four">
        {problems.map((problem) => (
          <article key={problem.title} className="landing-card">
            <div className="landing-card__icon">{problem.icon}</div>
            <h3>{problem.title}</h3>
            <p>{problem.copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
