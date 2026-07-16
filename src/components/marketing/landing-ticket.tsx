// The listing ticket — the one product artifact the landing page reuses.
// Pure presentational (no hooks) so it renders from server and client
// components alike. `stage` gates which parts are materialized so the
// interactive flow can evolve a single ticket instead of swapping scenes.

export type TicketStage =
  | "upload"
  | "draft"
  | "price"
  | "publish"
  | "sold"
  | "complete";

export type TicketLane = {
  name: string;
  mode: "publish" | "export";
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
  category: string;
  size: string;
  condition: string;
  measurements: string;
  price: string;
  confidence: number;
  comps: TicketComp[];
  lanes: TicketLane[];
  soldLine?: string;
  soldFollowups?: string[];
};

const STAGE_LEVEL: Record<TicketStage, number> = {
  upload: 0,
  draft: 1,
  price: 2,
  publish: 3,
  sold: 4,
  complete: 3,
};

function GarmentArt({ art }: { art: TicketItem["art"] }) {
  if (art === "coat") {
    return (
      <svg viewBox="0 0 96 112" fill="none" aria-hidden="true">
        {/* body: long overcoat, flared hem */}
        <path
          d="M40 10 L48 16 L56 10 L66 14 L70 22 L70 60 L73 102 L23 102 L26 60 L26 22 L30 14 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {/* sleeves, full length */}
        <path d="M70 22 L82 26 L86 66 L74 68 L70 44" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M26 22 L14 26 L10 66 L22 68 L26 44" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        {/* lapels */}
        <path d="M40 10 L48 34 L44 44 L38 22 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M56 10 L48 34 L52 44 L58 22 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        {/* placket + buttons */}
        <path d="M48 34 L48 102" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
        <circle cx="44" cy="52" r="1.4" fill="currentColor" />
        <circle cx="44" cy="64" r="1.4" fill="currentColor" />
        <circle cx="44" cy="76" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 112" fill="none" aria-hidden="true">
      <path
        d="M34 26 C34 14 62 14 62 26 L74 32 L80 52 L70 56 L68 48 L68 94 L28 94 L28 48 L26 56 L16 52 L22 32 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M34 26 C40 34 56 34 62 26" stroke="currentColor" strokeWidth="1.4" />
      <path d="M44 34 L44 44 M52 34 L52 44" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
      <rect x="36" y="52" width="24" height="10" stroke="currentColor" strokeWidth="1.3" />
      <path d="M34 80 L42 74 L54 74 L62 80" stroke="currentColor" strokeWidth="1.3" />
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
  const level = STAGE_LEVEL[stage];
  const on = (min: number) => (level >= min ? " is-on" : "");
  const sold = stage === "sold";

  return (
    <article
      className={`lp-ticket lp-ticket--${stage}${headline ? " lp-ticket--headline" : ""}`}
      aria-label={`Example listing: ${item.title}`}
    >
      <div className="lp-ticket__strip">
        <span>{item.lot}</span>
        <span>{item.condition}</span>
        <span>2026</span>
      </div>

      <div className="lp-ticket__body">
        <div className="lp-ticket__photo">
          <GarmentArt art={item.art} />
          <div className="lp-ticket__thumbs" aria-hidden="true">
            <span className="is-shot" />
            <span className={level >= 1 ? "is-shot" : ""} />
            <span className={level >= 1 ? "is-shot" : ""} />
          </div>
          <p className={`lp-ticket__photo-note${level >= 1 ? " is-done" : ""}`}>
            {level >= 1 ? "3 photos read" : "Drop photos"}
          </p>
        </div>

        <div className={`lp-ticket__fields${on(1)}`}>
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
              <dt>Meas.</dt>
              <dd>{item.measurements}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className={`lp-ticket__price${on(2)}`}>
        <div className="lp-ticket__ask">
          <span className="lp-ticket__ask-label">Suggested ask</span>
          <span className="lp-ticket__ask-value">{item.price}</span>
        </div>
        <div className="lp-ticket__conf">
          <span
            className="lp-ticket__conf-bar"
            role="img"
            aria-label={`Confidence ${item.confidence} percent`}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} className={i < Math.round(item.confidence / 20) ? "is-lit" : ""} />
            ))}
          </span>
          <span className="lp-ticket__conf-label">
            Confidence {item.confidence}%
          </span>
        </div>
        {item.comps.length > 0 ? (
          <ul className="lp-ticket__comps">
            {item.comps.map((comp) => (
              <li key={`${comp.source}-${comp.price}`}>
                <span>
                  Sold · {comp.source} · {comp.note}
                </span>
                <strong>{comp.price}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {sold ? (
        <div className="lp-ticket__sold">
          <p className="lp-ticket__sold-line">{item.soldLine}</p>
          <ul className="lp-ticket__sold-follow">
            {(item.soldFollowups ?? []).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={`lp-ticket__lanes${on(3)}`}>
          {item.lanes.map((lane) => (
            <span
              key={lane.name}
              className={`lp-ticket__lane lp-ticket__lane--${lane.mode}`}
            >
              <i>{lane.mode === "publish" ? "Publish" : "Export"}</i>
              {lane.name}
            </span>
          ))}
        </div>
      )}

      <div className="lp-ticket__foot">
        <span>Drafted by Sello</span>
        <span>Review before publish</span>
      </div>
    </article>
  );
}
