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
    <div
      className={`flex flex-col rounded-2xl border p-6 ${
        current ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-neutral-900">{plan.name}</h3>
        {current ? (
          <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">
            Current
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-3xl font-bold text-neutral-900">{priceLabel(plan)}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-neutral-700">
        {headlineRows(plan).map((row) => (
          <li key={row} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{row}</span>
          </li>
        ))}
      </ul>
      {cta ? <div className="mt-6">{cta}</div> : null}
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
    <div className="grid gap-4 md:grid-cols-3">
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
