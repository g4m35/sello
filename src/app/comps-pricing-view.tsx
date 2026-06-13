// Pure presentational comps/pricing views. Intentionally NOT a "use client"
// entry file: these components take callback props (onEdit/onToggle/...), which
// would trip Next's client-boundary serializability rule if exported from a
// "use client" module. They use no hooks, so they render fine inside the
// client container (comps-panel.tsx) and in renderToStaticMarkup tests.

export type Confidence = "none" | "low" | "medium" | "high";
export type CompStatus = "sold" | "active" | "unknown";

export type Summary = {
  status: "needs_comps" | "ready";
  totalComps: number;
  validComps: number;
  compCount: number;
  soldCompCount: number;
  activeCompCount: number;
  lowCents: number | null;
  medianCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: Confidence;
  confidenceScore: number;
  confidenceReasons: string[];
};

export type CompRow = {
  id: string;
  source: string;
  platform: string | null;
  status: CompStatus;
  title: string;
  brand: string | null;
  size: string | null;
  priceCents: number;
  shippingCents: number;
  totalPriceCents: number | null;
  soldDate: string | null;
  url: string | null;
  condition: string;
  usedInPricing: boolean;
  ignoredAsOutlier: boolean;
  notes: string | null;
};

export function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

export function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const confidenceStyles: Record<Confidence, string> = {
  none: "border-neutral-300 bg-neutral-100 text-neutral-600",
  low: "border-amber-300 bg-amber-50 text-amber-900",
  medium: "border-sky-300 bg-sky-50 text-sky-900",
  high: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

const statusStyles: Record<CompStatus, string> = {
  sold: "bg-emerald-100 text-emerald-800",
  active: "bg-sky-100 text-sky-800",
  unknown: "bg-neutral-100 text-neutral-600",
};

export function PricingRecommendationCard({ summary }: { summary: Summary }) {
  const needsComps = summary.status === "needs_comps";
  const tiles: Array<[string, number | null]> = [
    ["Low", summary.lowCents],
    ["Median", summary.medianCents],
    ["Average", summary.averageCents],
    ["High", summary.highCents],
    ["Quick sale", summary.quickSaleCents],
    ["Recommended", summary.recommendedListCents],
  ];

  return (
    <div className="border border-neutral-300 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-500">
          Comp-based pricing
        </h3>
        <span
          className={`border px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${confidenceStyles[summary.confidence]}`}
        >
          {summary.confidence === "none" ? "Needs comps" : `${summary.confidence} confidence`}
        </span>
      </div>

      {needsComps ? (
        <p className="mt-3 text-sm text-neutral-600">
          Add sold or active comps to improve pricing confidence. Pricing is never invented
          without comps.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map(([label, value]) => (
              <div
                key={label}
                className={`border p-3 ${label === "Median" ? "border-neutral-900" : "border-neutral-200"}`}
              >
                <dt className="text-xs uppercase tracking-[0.12em] text-neutral-500">{label}</dt>
                <dd className="mt-1 text-base font-semibold">{formatCents(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-neutral-500">
            {summary.soldCompCount} sold · {summary.activeCompCount} active · {summary.compCount}{" "}
            used of {summary.totalComps} total. You can override the final price in the editor.
          </p>
          {summary.confidenceReasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-neutral-600">
              {summary.confidenceReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CompsTable({
  comps,
  onEdit,
  onDelete,
  onToggle,
  busyId,
}: {
  comps: CompRow[];
  onEdit: (comp: CompRow) => void;
  onDelete: (comp: CompRow) => void;
  onToggle: (comp: CompRow, field: "usedInPricing" | "ignoredAsOutlier") => void;
  busyId?: string | null;
}) {
  return (
    <div className="border border-neutral-300 bg-white">
      <div className="border-b border-neutral-200 p-4">
        <p className="text-sm font-semibold">Comps ({comps.length})</p>
      </div>
      {comps.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">
          No comps yet. Add sold or active comps to improve pricing confidence.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-[0.12em] text-neutral-500">
              <tr>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Title</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Total</th>
                <th className="px-3 py-3 font-medium">Use in pricing</th>
                <th className="px-3 py-3 font-medium">Outlier</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((comp) => {
                const total = comp.totalPriceCents ?? comp.priceCents + comp.shippingCents;
                return (
                  <tr key={comp.id} className="border-b border-neutral-100 align-top">
                    <td className="px-3 py-3">
                      {comp.source}
                      {comp.platform ? (
                        <span className="block text-xs text-neutral-400">{comp.platform}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {comp.url && isHttpUrl(comp.url) ? (
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-700 underline"
                        >
                          {comp.title}
                        </a>
                      ) : (
                        comp.title
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium capitalize ${statusStyles[comp.status]}`}
                      >
                        {comp.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium">{formatCents(total)}</td>
                    <td className="px-3 py-3">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={comp.usedInPricing}
                          disabled={busyId === comp.id}
                          onChange={() => onToggle(comp, "usedInPricing")}
                          aria-label="Use in pricing"
                        />
                        <span className="sr-only">Use in pricing</span>
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={comp.ignoredAsOutlier}
                          disabled={busyId === comp.id}
                          onChange={() => onToggle(comp, "ignoredAsOutlier")}
                          aria-label="Ignore as outlier"
                        />
                        <span className="sr-only">Outlier</span>
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(comp)}
                          className="inline-flex items-center gap-1 border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(comp)}
                          disabled={busyId === comp.id}
                          className="inline-flex items-center gap-1 border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
