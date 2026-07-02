import type { ReactNode } from "react";

import { PLAN_CATALOG, PLAN_IDS, type Plan, type PlanId } from "@/lib/billing/plans";

function priceLabel(plan: Plan): string {
  if (plan.priceCents === 0) return "$0";
  return `$${plan.priceCents / 100}/mo`;
}

function headlineRows(plan: Plan): string[] {
  const l = plan.limits;
  return [
    `${l.aiListingsPerMonth.toLocaleString()} AI listings / mo`,
    `${l.autopublishesPerMonth.toLocaleString()} autopublishes / mo`,
    `${l.compRefreshesPerMonth.toLocaleString()} comp refreshes / mo`,
    `${l.marketplaceConnections} marketplace connection${l.marketplaceConnections === 1 ? "" : "s"}`,
    `Bulk actions up to ${l.bulkBatchSize} items`,
    `${l.teamSeats} team seat${l.teamSeats === 1 ? "" : "s"}`,
  ];
}

export function PlanCard({
  plan,
  current,
  cta,
}: {
  plan: Plan;
  current?: boolean;
  cta?: ReactNode;
}) {
  return (
    <div className={`card plan-card ${current ? "plan-card--current" : ""}`}>
      <div className="plan-card__head">
        <h3 className="t-h2">{plan.name}</h3>
        {current ? (
          <span className="badge badge--published">Current</span>
        ) : null}
      </div>
      <p className="plan-card__price t-num">{priceLabel(plan)}</p>
      <ul className="plan-card__list">
        {headlineRows(plan).map((row) => (
          <li key={row}>
            <span aria-hidden className="plan-card__dot" />
            <span>{row}</span>
          </li>
        ))}
      </ul>
      {cta ? <div className="plan-card__cta">{cta}</div> : null}
    </div>
  );
}

export function PlanCards({
  currentPlan,
  renderCta,
}: {
  currentPlan?: PlanId;
  renderCta?: (planId: PlanId) => ReactNode;
}) {
  return (
    <div className="plan-grid">
      {PLAN_IDS.map((id) => (
        <PlanCard
          key={id}
          plan={PLAN_CATALOG[id]}
          current={id === currentPlan}
          cta={renderCta?.(id)}
        />
      ))}
    </div>
  );
}
