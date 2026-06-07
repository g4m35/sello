"use client";

import { useEffect, useState } from "react";

import { Banner, Btn } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { formatMoneyCents } from "@/lib/view/format";

type Summary = {
  status: string;
  totalComps: number;
  validComps: number;
  lowCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: string;
};

// Read-only automatic pricing. Comps are gathered for the seller, not entered by
// hand. Pricing is computed from real comps only; nothing is invented. A
// "Refresh comps" action runs the configured comp sources on demand.
export function AutoPricing({ itemId }: { itemId: string }) {
  const { token } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
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
      setNote(
        res.enabled === 0
          ? "No comp source is connected yet. Add a source to gather comps automatically."
          : `Fetched ${res.fetched} comp${res.fetched === 1 ? "" : "s"} from ${res.sources.join(", ")}.`,
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
  if (!summary) return <div className="t-small muted">Loading pricing…</div>;

  const hasData = summary.validComps > 0 && summary.recommendedListCents != null;

  if (!hasData) {
    return (
      <div className="stack-3">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="t-micro">Automatic pricing</span>
          {refreshBtn}
        </div>
        <Banner
          variant="info"
          icon="spark"
          title="Comps are gathered automatically"
          desc="We price from real sold comps, never invented numbers. No comp source is connected yet, so there is nothing to price from. Recommended price stays blank until comps arrive."
        />
        {note && <div className="t-small muted">{note}</div>}
      </div>
    );
  }

  const stats: { label: string; value: string }[] = [
    { label: "Lowest", value: formatMoneyCents(summary.lowCents) },
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
      {note && <div className="t-small muted">{note}</div>}
    </div>
  );
}
