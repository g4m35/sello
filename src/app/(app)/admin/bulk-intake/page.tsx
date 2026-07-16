"use client";

import { useEffect, useState } from "react";

import { AdminNav } from "@/components/app/admin-nav";
import { Topbar } from "@/components/app/topbar";
import { useSession } from "@/components/providers/session-provider";
import { api, type AdminBulkBatchRow } from "@/lib/api/client";

type Totals = { batches: number; active: number; ready: number; failed: number; items: number };

export default function AdminBulkIntakePage() {
  const { token } = useSession();
  const [rows, setRows] = useState<AdminBulkBatchRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getAdminBulkIntake(token)
      .then((result) => {
        if (!active) return;
        setRows(result.rows);
        setTotals(result.totals);
      })
      .catch((reason) => {
        if (active) setError((reason as { error?: string }).error ?? "Not found.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <>
      <Topbar crumbs={["Admin", "Bulk intake"]} />
      <main className="page stack-3">
        <AdminNav active="/admin/bulk-intake" />
        <div className="page__head">
          <h1 className="page__title">Bulk intake operations</h1>
          <div className="page__title-meta">Durable batch progress and review visibility.</div>
        </div>

        {error ? <div className="banner banner--error">{error}</div> : null}

        {totals ? (
          <div className="form-grid form-grid--3">
            {[
              ["Batches", totals.batches],
              ["Active", totals.active],
              ["Ready", totals.ready],
              ["Failed / partial", totals.failed],
              ["Items", totals.items],
            ].map(([label, value]) => (
              <div key={label} className="card" style={{ padding: 12 }}>
                <div className="t-micro">{label}</div>
                <div className="t-num" style={{ fontSize: 22 }}>{value}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="stack-1">
          {rows.map((row) => (
            <article key={row.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong className="t-small">Batch {row.id.slice(0, 8)}</strong>
                <span className="badge">{row.status.replaceAll("_", " ")}</span>
              </div>
              <div className="t-micro muted">
                {row.processedItems}/{row.totalItems} processed · {row.photoCount} photos · {row.listingReadyItems} ready · {row.needsReviewItems} review · {row.failedItems} failed
              </div>
              <div className="t-micro muted">
                account {row.accountId} · updated {new Date(row.updatedAt).toLocaleString()}
              </div>
            </article>
          ))}
          {!error && totals && rows.length === 0 ? (
            <div className="t-small muted">No bulk intake batches yet.</div>
          ) : null}
        </div>
      </main>
    </>
  );
}
