"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Topbar } from "@/components/app/topbar";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states";
import { Badge, Banner, Btn, Tabs } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MpLogo } from "@/components/ui/marketplace";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { durationLabel } from "@/lib/view/format";
import { DESIGN_STATUS_LABEL } from "@/lib/view/status";
import { marketplaceName } from "@/lib/view/marketplaces";
import type { AttemptView, DesignStatus } from "@/lib/view/types";

type TabValue = "all" | "publishing" | "published" | "failed" | "noimpl";

const TAB_LABEL: Record<TabValue, string> = {
  all: "All",
  publishing: DESIGN_STATUS_LABEL.publishing,
  published: DESIGN_STATUS_LABEL.published,
  failed: DESIGN_STATUS_LABEL.failed,
  noimpl: DESIGN_STATUS_LABEL.noimpl,
};

// Maps a tab to the design status it filters on.
const TAB_STATUS: Record<Exclude<TabValue, "all">, DesignStatus> = {
  publishing: "publishing",
  published: "published",
  failed: "failed",
  noimpl: "noimpl",
};

// Renders a day-group heading: "Today", "Yesterday", or a weekday + date.
function dayLabel(dayKey: string, now: Date = new Date()): string {
  const date = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dayKey;
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type DayGroup = { key: string; attempts: AttemptView[] };

export default function HistoryPage() {
  const router = useRouter();
  const { token } = useSession();

  const [attempts, setAttempts] = useState<AttemptView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabValue>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await api.getHistory(token);
        if (!active) return;
        setAttempts(res.attempts);
        setLoadError(null);
      } catch (e) {
        if (active) {
          setLoadError((e as { error?: string })?.error ?? "Failed to load history.");
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const counts = useMemo(() => {
    const base = { publishing: 0, published: 0, failed: 0, noimpl: 0 };
    for (const a of attempts ?? []) base[a.status as keyof typeof base] += 1;
    return base;
  }, [attempts]);

  const avgTime = useMemo(() => {
    const list = (attempts ?? []).filter(
      (a): a is AttemptView & { durationMs: number } => a.durationMs != null,
    );
    if (list.length === 0) return "—";
    const mean = list.reduce((sum, a) => sum + a.durationMs, 0) / list.length;
    return durationLabel(Math.round(mean));
  }, [attempts]);

  const notImplCount = useMemo(
    () => (attempts ?? []).filter((a) => a.rawStatus === "NOT_IMPLEMENTED").length,
    [attempts],
  );

  const tabItems = useMemo(() => {
    const all = attempts?.length ?? 0;
    return [
      { value: "all", label: TAB_LABEL.all, count: all },
      { value: "publishing", label: TAB_LABEL.publishing, count: counts.publishing },
      { value: "published", label: TAB_LABEL.published, count: counts.published },
      { value: "failed", label: TAB_LABEL.failed, count: counts.failed },
      { value: "noimpl", label: TAB_LABEL.noimpl, count: counts.noimpl },
    ];
  }, [attempts, counts]);

  const filtered = useMemo(() => {
    const list = attempts ?? [];
    if (tab === "all") return list;
    return list.filter((a) => a.status === TAB_STATUS[tab]);
  }, [attempts, tab]);

  // Group filtered attempts by day (newest day first, newest attempt first).
  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, AttemptView[]>();
    for (const a of [...filtered].sort((x, y) => y.time.localeCompare(x.time))) {
      const key = a.time.slice(0, 10);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(a);
      else byDay.set(key, [a]);
    }
    return [...byDay.entries()].map(([key, items]) => ({ key, attempts: items }));
  }, [filtered]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const topbarRight = (
    <>
      <Btn variant="secondary" size="sm" icon="download" disabled title="Coming soon">
        Export
      </Btn>
      <Btn variant="secondary" size="sm" icon="refresh" onClick={reload}>
        Refresh
      </Btn>
    </>
  );

  if (loadError) {
    return (
      <>
        <Topbar crumbs={["Publish history"]} right={topbarRight} />
        <main className="page">
          <ErrorState message={loadError} onRetry={reload} />
        </main>
      </>
    );
  }

  if (attempts === null) return <PageSkeleton />;

  const total = attempts.length;

  const renderBody = () => {
    if (total === 0) {
      return (
        <EmptyState
          icon="history"
          title={
            <>
              No publish attempts <em>yet</em>
            </>
          }
          desc="When you run publish from an item, every channel attempt is logged here."
          actions={
            <Btn variant="secondary" icon="package" onClick={() => router.push("/inventory")}>
              Go to inventory
            </Btn>
          }
        />
      );
    }

    if (filtered.length === 0) {
      return (
        <EmptyState
          icon="check-c"
          title={`Nothing in ${TAB_LABEL[tab]}`}
          actions={
            <Btn variant="secondary" onClick={() => setTab("all")}>
              View all
            </Btn>
          }
        />
      );
    }

    return (
      <div className="card">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="card__head">
              <div className="card__title">{dayLabel(group.key)}</div>
              <span className="muted t-small">
                {group.attempts.length}{" "}
                {group.attempts.length === 1 ? "attempt" : "attempts"}
              </span>
            </div>
            {group.attempts.map((a) => {
              const isOpen = expanded.has(a.id);
              return (
                <div key={a.id}>
                  <div
                    className="log-line"
                    onClick={() => toggleExpanded(a.id)}
                    style={{ cursor: "pointer" }}
                    role="button"
                    aria-expanded={isOpen}
                  >
                    <div className="log-line__time t-mono">{timeOfDay(a.time)}</div>
                    <Badge status={a.status} />
                    <div className="log-line__detail">
                      <MpLogo id={a.marketplace} size={20} />
                      <span className="log-line__title">{a.itemTitle}</span>
                      <span className="log-line__id">
                        {marketplaceName(a.marketplace)}
                      </span>
                      {a.reason && (
                        <span className="muted t-small">{a.reason}</span>
                      )}
                    </div>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                      <span className="muted t-num">{durationLabel(a.durationMs)}</span>
                      <Icon name={isOpen ? "chevD" : "chevR"} size={14} />
                    </div>
                  </div>

                  {isOpen && (
                    <div className="log-detail">
                      <div className="log-detail__grid">
                        <div>
                          <div className="muted t-small">Request</div>
                          <pre>
                            {JSON.stringify(
                              {
                                inventoryItemId: a.itemId,
                                marketplace: a.marketplace,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                        <div>
                          <div className="muted t-small">Response</div>
                          <pre>
                            {JSON.stringify(
                              {
                                status: a.rawStatus,
                                code: a.code,
                                reason: a.reason,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      </div>
                      <div className="row" style={{ marginTop: 12 }}>
                        <Btn
                          variant="secondary"
                          size="sm"
                          icon="external"
                          onClick={() => router.push(`/inventory/${a.itemId}`)}
                        >
                          Open item
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <Topbar crumbs={["Publish history"]} right={topbarRight} />
      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Publish <em>history</em>
            </h1>
            <div className="page__title-meta">
              {total} {total === 1 ? "attempt" : "attempts"} in this workspace
            </div>
          </div>
        </div>

        {notImplCount > 0 && (
          <Banner
            variant="info"
            title="Publishing is not enabled yet"
            desc="Attempts are recorded for audit. No listing is sent to any marketplace until real adapters ship."
          />
        )}

        <div className="kpis">
          <div className="kpi">
            <div className="kpi__label">Attempts</div>
            <div className="kpi__value">{total}</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Succeeded</div>
            <div className="kpi__value">{counts.published}</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Failed</div>
            <div className="kpi__value">{counts.failed}</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Not implemented</div>
            <div className="kpi__value">{notImplCount}</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Avg time</div>
            <div className="kpi__value">{avgTime}</div>
          </div>
        </div>

        <div className="toolbar">
          <Tabs items={tabItems} value={tab} onChange={(v) => setTab(v as TabValue)} />
        </div>

        {renderBody()}
      </main>
    </>
  );
}
