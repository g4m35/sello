"use client";

import { useEffect, useState } from "react";

import { AdminNav } from "@/components/app/admin-nav";
import { Topbar } from "@/components/app/topbar";
import { Badge, Btn } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session-provider";
import { api, type AdminFeedbackRow } from "@/lib/api/client";

const STATUS_FILTERS = ["", "open", "reviewing", "resolved", "dismissed"] as const;

export default function AdminFeedbackPage() {
  const { token } = useSession();
  const [rows, setRows] = useState<AdminFeedbackRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const query = statusFilter ? `?status=${statusFilter}` : "";
        const res = await api.getAdminFeedback(token, query);
        if (active) {
          setRows(res.rows);
          setOpenCount(res.openCount);
          setError(null);
        }
      } catch (e) {
        if (active) setError((e as { error?: string })?.error ?? "Not found.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, statusFilter, reloadKey]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    try {
      await api.updateFeedback(token, id, { status });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not update.");
    } finally {
      setBusyId(null);
    }
  }

  if (loaded && error) {
    return (
      <>
        <Topbar crumbs={["Admin", "Feedback"]} />
        <div className="page">
          <AdminNav active="/admin/feedback" />
          <div className="t-small muted">Not found.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar crumbs={["Admin", "Feedback"]} />
      <div className="page stack-3">
        <AdminNav active="/admin/feedback" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 className="t-h2">Feedback ({openCount} open)</h1>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s || "all"} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </select>
        </div>

        {rows.length === 0 && loaded ? (
          <div className="t-small muted">No feedback yet.</div>
        ) : (
          <div className="stack-2">
            {rows.map((row) => (
              <div key={row.id} className="card" style={{ padding: 14 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
                  <div className="stack-1" style={{ minWidth: 0 }}>
                    <div className="t-small" style={{ fontWeight: 650 }}>
                      {row.subject}
                    </div>
                    <div className="t-micro">
                      {row.type} · {row.severity}
                      {row.marketplace ? ` · ${row.marketplace}` : ""} · {row.status} ·{" "}
                      {new Date(row.createdAt).toLocaleString()}
                    </div>
                    <div className="t-small muted" style={{ whiteSpace: "pre-wrap" }}>
                      {row.message}
                    </div>
                    <div className="t-micro muted">user {row.userId}</div>
                  </div>
                  <Badge label={row.status} />
                </div>
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  {(["reviewing", "resolved", "dismissed"] as const).map((s) => (
                    <Btn
                      key={s}
                      variant="ghost"
                      size="sm"
                      disabled={busyId === row.id || row.status === s}
                      onClick={() => setStatus(row.id, s)}
                    >
                      {s}
                    </Btn>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
