"use client";

import { useEffect, useState } from "react";

import { Banner, Btn } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { getAutoCompStatusCopy } from "@/lib/comps/status";
import { formatMoneyCents } from "@/lib/view/format";

type Summary = {
  status: string;
  totalComps: number;
  validComps: number;
  soldCompCount?: number;
  activeCompCount?: number;
  lowCents: number | null;
  medianCents?: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: string;
  confidenceScore?: number;
  confidenceReasons?: string[];
};

type Discovery = {
  status: string;
  autoDiscoveryEnabled: boolean;
  enabledSources: string[];
  queries: string[];
  sourceErrors: { source: string; message: string }[];
  lastRunAt: string | null;
  acceptedCount?: number | null;
  rejectedCount?: number | null;
};

// Read-only automatic pricing. Comps are gathered for the seller, not entered by
// hand. Pricing is computed from real comps only; nothing is invented. A
// "Refresh comps" action runs the configured comp sources on demand.
export function AutoPricing({
  itemId,
  onApplyPrice,
}: {
  itemId: string;
  onApplyPrice?: (priceCents: number) => void;
}) {
  const { token } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await api.getComps(token, itemId);
        if (active) {
          setSummary(res.summary);
          setDiscovery(res.discovery);
          setError(null);
        }
      } catch (e) {
        if (active) setError((e as { error?: string })?.error ?? "Could not load pricing.");
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, itemId, reloadKey]);

  async function refresh() {
    setRefreshing(true);
    setNote(null);
    try {
      const res = await api.refreshComps(token, itemId);
      setReloadKey((k) => k + 1);
      if (res.appliedPriceCents != null) onApplyPrice?.(res.appliedPriceCents);
      setNote(
        res.enabled === 0
          ? "No automatic comp source is connected. Manual comps still work."
          : `Checked ${res.sources.join(", ")} · ${res.accepted} accepted · ${res.rejected} filtered.`,
      );
    } catch (e) {
      setNote((e as { error?: string })?.error ?? "Could not refresh comps.");
    } finally {
      setRefreshing(false);
    }
  }

  const refreshBtn = (
    <Btn variant="secondary" size="sm" icon="refresh" onClick={refresh} disabled={refreshing}>
      {refreshing ? "Fetching…" : "Refresh comps"}
    </Btn>
  );

  if (error) return <div className="t-small danger">{error}</div>;
  if (!summary || !discovery) return <div className="t-small muted">Loading pricing…</div>;

  const hasData = summary.validComps > 0 && summary.recommendedListCents != null;
  const copy = getAutoCompStatusCopy(discovery, summary);
  const queryList = discovery.queries.slice(0, 4);
  const sourceList = discovery.enabledSources.length > 0 ? discovery.enabledSources.join(", ") : "None";
  const canAccept =
    summary.recommendedListCents != null &&
    (summary.confidence === "medium" || summary.confidence === "low") &&
    onApplyPrice;

  const details = (
    <div className="stack-2">
      <div>Sources: {sourceList}</div>
      {queryList.length > 0 && (
        <div>
          Queries: {queryList.join(" · ")}
        </div>
      )}
      {discovery.sourceErrors.length > 0 && (
        <div>
          Source errors:{" "}
          {discovery.sourceErrors.map((err) => `${err.source}: ${err.message}`).join(" · ")}
        </div>
      )}
      {note && <div>{note}</div>}
    </div>
  );

  if (!hasData) {
    return (
      <div className="stack-3">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="t-micro">Automatic pricing</span>
          {refreshBtn}
        </div>
        <Banner
          variant={copy.variant}
          icon="spark"
          title={copy.title}
          desc={details}
        />
      </div>
    );
  }

  const stats: { label: string; value: string }[] = [
    { label: "Lowest", value: formatMoneyCents(summary.lowCents) },
    { label: "Median", value: formatMoneyCents(summary.medianCents ?? null) },
    { label: "Average", value: formatMoneyCents(summary.averageCents) },
    { label: "Highest", value: formatMoneyCents(summary.highCents) },
    { label: "Quick sale", value: formatMoneyCents(summary.quickSaleCents) },
    { label: "Recommended", value: formatMoneyCents(summary.recommendedListCents) },
  ];

  return (
    <div className="stack-3">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="t-small muted">
          From {summary.validComps} comp{summary.validComps === 1 ? "" : "s"}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge badge--ready" style={{ textTransform: "capitalize" }}>
            {summary.confidence} confidence
          </span>
          {refreshBtn}
        </div>
      </div>
      <div className="form-grid form-grid--3" style={{ gap: 12 }}>
        {stats.map((s) => (
          <div key={s.label} className="card" style={{ padding: 12 }}>
            <div className="t-micro">{s.label}</div>
            <div className="t-num" style={{ fontFamily: "var(--font-serif)", fontSize: 22 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <Banner
        variant={copy.variant}
        title={copy.title}
        desc={details}
        actions={
          canAccept ? (
            <Btn
              variant="secondary"
              size="sm"
              onClick={() => onApplyPrice?.(summary.recommendedListCents as number)}
            >
              Accept recommendation
            </Btn>
          ) : undefined
        }
      />
      {summary.confidenceReasons && summary.confidenceReasons.length > 0 && (
        <ul className="stack-1 t-small muted" style={{ paddingLeft: 18 }}>
          {summary.confidenceReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
