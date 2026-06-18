"use client";

import { useEffect, useState } from "react";

import { Topbar } from "@/components/app/topbar";
import { useSession } from "@/components/providers/session-provider";
import { api, type ProviderUsageRow } from "@/lib/api/client";
import { formatMoneyCents } from "@/lib/view/format";

type Totals = {
  todaySpendCents: number;
  monthSpendCents: number;
  todayCalls: number;
  monthCalls: number;
  todaySkipped: number;
  todayFailures: number;
};

export default function AdminProviderUsagePage() {
  const { token } = useSession();
  const [rows, setRows] = useState<ProviderUsageRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [paidEnabled, setPaidEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getAdminProviderUsage(token)
      .then((res) => {
        if (!active) return;
        setRows(res.rows);
        setTotals(res.totals);
        setPaidEnabled(res.paidProvidersEnabled);
      })
      .catch((e) => active && setError((e as { error?: string })?.error ?? "Not found."))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [token]);

  if (loaded && error) {
    return (
      <>
        <Topbar crumbs={["Admin", "Provider usage"]} />
        <div className="page t-small muted">{error}</div>
      </>
    );
  }

  const cards: { label: string; value: string }[] = totals
    ? [
        { label: "Spend today", value: formatMoneyCents(totals.todaySpendCents) },
        { label: "Spend this month", value: formatMoneyCents(totals.monthSpendCents) },
        { label: "Paid calls today", value: String(totals.todayCalls) },
        { label: "Paid calls this month", value: String(totals.monthCalls) },
        { label: "Skipped today", value: String(totals.todaySkipped) },
        { label: "Failures today", value: String(totals.todayFailures) },
      ]
    : [];

  return (
    <>
      <Topbar crumbs={["Admin", "Provider usage"]} />
      <div className="page stack-3">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 className="t-h2">Paid comp provider usage</h1>
          <span className={`badge ${paidEnabled ? "badge--ready" : ""}`}>
            paid providers {paidEnabled ? "enabled" : "disabled"}
          </span>
        </div>

        <div className="form-grid form-grid--3" style={{ gap: 12 }}>
          {cards.map((c) => (
            <div key={c.label} className="card" style={{ padding: 12 }}>
              <div className="t-micro">{c.label}</div>
              <div className="t-num" style={{ fontSize: 22 }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>

        {rows.length === 0 && loaded ? (
          <div className="t-small muted">No provider usage yet.</div>
        ) : (
          <div className="stack-1">
            {rows.map((r) => (
              <div key={r.id} className="card" style={{ padding: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="t-small">
                    {r.provider} · {r.status}
                    {r.skippedReason ? ` · ${r.skippedReason}` : ""}
                  </span>
                  <span className="t-micro">{formatMoneyCents(r.estimatedCostCents)}</span>
                </div>
                <div className="t-micro muted">
                  fetched {r.fetchedCount} · accepted {r.acceptedCount} · rejected {r.rejectedCount}
                  {r.userId ? ` · user ${r.userId}` : ""} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
