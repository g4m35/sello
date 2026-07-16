import {
  LandingTicket,
  type TicketItem,
  type TicketStage,
} from "@/components/marketing/landing-ticket";

export type FlowStep = {
  id: TicketStage;
  title: string;
  caption: string;
};

export function LandingFlow({
  steps,
  item,
}: {
  steps: FlowStep[];
  item: TicketItem;
}) {
  return (
    <div className="lp-flow" data-sequence="lifecycle">
      <ol className="lp-flow__rail" aria-label="Item lifecycle">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`lp-flow__step lp-flow__step--${step.id}`}
            data-lifecycle-state={step.id}
          >
            <span className="lp-flow__index">{String(index + 1).padStart(2, "0")}</span>
            <span className="lp-flow__marker" aria-hidden="true" />
            <span className="lp-flow__copy">
              <strong>{step.title}</strong>
              <span>{step.caption}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="lp-flow__record">
        <div className="lp-flow__status">
          <span>LOT 0417</span>
          <span>Eight states · one record</span>
        </div>
        <LandingTicket item={item} stage="sold" />
      </div>
    </div>
  );
}
