export type TicketStage =
  | "intake"
  | "generated"
  | "priced"
  | "published"
  | "live"
  | "sale-detected"
  | "delisted"
  | "sold";

export type TicketLaneTier = "direct" | "guided" | "approval";

export type TicketLaneState =
  | "active"
  | "pending"
  | "failed"
  | "sold"
  | "delisted"
  | "review";

export type TicketLane = {
  name: string;
  tier: TicketLaneTier;
  state: TicketLaneState;
  note: string;
};

export type TicketComp = {
  source: string;
  note: string;
  price: string;
};

export type TicketItem = {
  lot: string;
  art: "coat" | "hoodie";
  title: string;
  brand: string;
  category: string;
  size: string;
  condition: string;
  measurements: string;
  flaw: string;
  attributes: string;
  price: string;
  quickSale: string;
  confidence: number;
  readiness: string[];
  comps: TicketComp[];
  lanes: TicketLane[];
  audit?: string[];
};

const STAGE_LABELS: Record<TicketStage, string> = {
  intake: "Intake",
  generated: "Generated",
  priced: "Priced",
  published: "Published",
  live: "Live",
  "sale-detected": "Sale detected",
  delisted: "Delisted elsewhere",
  sold: "Sold · synchronized",
};

function GarmentArt({ art }: { art: TicketItem["art"] }) {
  if (art === "coat") {
    return (
      <svg viewBox="0 0 96 112" fill="none" aria-hidden="true">
        <path
          d="M40 10 48 16 56 10 66 14 70 22 70 60 73 102 23 102 26 60 26 22 30 14Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="m70 22 12 4 4 40-12 2-4-24M26 22l-12 4-4 40 12 2 4-24"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="m40 10 8 24-4 10-6-22M56 10l-8 24 4 10 6-22M48 34v68"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <circle cx="44" cy="52" r="1.4" fill="currentColor" />
        <circle cx="44" cy="64" r="1.4" fill="currentColor" />
        <circle cx="44" cy="76" r="1.4" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 112" fill="none" aria-hidden="true">
      <path
        d="M34 26c0-12 28-12 28 0l12 6 6 20-10 4-2-8v46H28V48l-2 8-10-4 6-20Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M34 26c6 8 22 8 28 0M44 34v10M52 34v10" stroke="currentColor" strokeWidth="1.3" />
      <rect x="36" y="52" width="24" height="10" stroke="currentColor" strokeWidth="1.3" />
      <path d="m34 80 8-6h12l8 6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function LandingTicket({
  item,
  stage,
  headline = false,
}: {
  item: TicketItem;
  stage: TicketStage;
  headline?: boolean;
}) {
  return (
    <article
      className={`lp-ticket lp-ticket--${stage}${headline ? " lp-ticket--headline" : ""}`}
      data-ticket-stage={stage}
      data-ticket-record
      aria-label={`Lot record for ${item.title}, ${STAGE_LABELS[stage]}`}
    >
      <div className="lp-ticket__strip">
        <span>{item.lot}</span>
        <span className={`lp-state lp-state--${stage} lp-stamp`} data-ticket-status>
          {STAGE_LABELS[stage]}
        </span>
      </div>

      <div className="lp-ticket__body">
        <div className="lp-ticket__photo" data-ticket-part="photos">
          <GarmentArt art={item.art} />
          <div className="lp-ticket__thumbs" aria-label="Four photos checked">
            <span className="is-shot" />
            <span className="is-shot" />
            <span className="is-shot" />
            <span className="is-shot" />
          </div>
          <p className="lp-ticket__photo-note">Photo evidence read</p>
        </div>

        <div className="lp-ticket__fields" data-ticket-part="fields">
          <p className="lp-ticket__brand">{item.brand}</p>
          <h3 className="lp-ticket__title">{item.title}</h3>
          <dl className="lp-ticket__specs">
            <div>
              <dt>Category</dt>
              <dd>{item.category}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{item.size}</dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>{item.condition}</dd>
            </div>
            <div>
              <dt>Measure</dt>
              <dd>{item.measurements}</dd>
            </div>
            <div>
              <dt>Flaw</dt>
              <dd>{item.flaw}</dd>
            </div>
            <div>
              <dt>Specifics</dt>
              <dd>{item.attributes}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="lp-ticket__readiness" data-readiness="passed" data-ticket-part="readiness">
        <span>Readiness checks</span>
        <ul>
          {item.readiness.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </div>

      <div className="lp-ticket__price" data-ticket-part="price">
        <div className="lp-ticket__ask">
          <span className="lp-ticket__ask-label">List range</span>
          <span className="lp-ticket__ask-value">{item.price}</span>
          <span className="lp-ticket__quick">Quick sale {item.quickSale}</span>
        </div>
        <div className="lp-ticket__conf">
          <span
            className="lp-ticket__conf-bar"
            role="img"
            aria-label={`Confidence ${item.confidence} percent`}
          >
            {[0, 1, 2, 3, 4].map((index) => (
              <i key={index} className={index < Math.round(item.confidence / 20) ? "is-lit" : ""} />
            ))}
          </span>
          <span className="lp-ticket__conf-label">Confidence {item.confidence}%</span>
        </div>
        {item.comps.length > 0 ? (
          <ul className="lp-ticket__comps">
            {item.comps.map((comp) => (
              <li key={`${comp.source}-${comp.note}-${comp.price}`}>
                <span>Sold · {comp.source} · {comp.note}</span>
                <strong>{comp.price}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="lp-ticket__lanes" data-ticket-part="lanes" aria-label="Marketplace lane states">
        {item.lanes.map((lane) => (
          <div
            key={lane.name}
            className={`lp-ticket__lane lp-ticket__lane--${lane.tier} is-${lane.state}`}
            data-lane-tier={lane.tier}
            data-lane-state={lane.state}
            data-lane-name={lane.name.toLowerCase()}
          >
            <span className="lp-ticket__lane-name">{lane.name}</span>
            <span
              className={`lp-ticket__lane-state${
                lane.state === "sold" || lane.state === "delisted" || lane.state === "review"
                  ? " lp-stamp"
                  : ""
              }`}
            >
              {lane.state}
            </span>
            <span className="lp-ticket__lane-note">{lane.note}</span>
          </div>
        ))}
      </div>

      {item.audit ? (
        <ol className="lp-ticket__audit" data-ticket-part="audit" aria-label="Illustrative audit history">
          {item.audit.map((event, index) => (
            <li key={event} data-audit-line={String(index + 1).padStart(2, "0")}>
              {event}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="lp-ticket__foot">
        <span>One item record</span>
        <span>Review before live</span>
      </div>
    </article>
  );
}
