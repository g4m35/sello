"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { isPublishReady } from "@/lib/view/item-readiness-bucket";
import { Badge, Btn, Check } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MpLogo, MpDots, Thumb } from "@/components/ui/marketplace";
import { Topbar } from "@/components/app/topbar";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states";
import { PublishModal } from "@/components/app/publish-modal";
import {
  formatMoneyCents,
  estPayoutCents,
  relativeTime,
} from "@/lib/view/format";
import type {
  AttemptView,
  ChannelView,
  ItemView,
} from "@/lib/view/types";

type AttentionRow = {
  id: string;
  itemId: string;
  title: string;
  sub: string;
  tone: "miss" | "warn";
};

function greetingForHour(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function firstWord(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}

export default function DashboardPage() {
  const router = useRouter();
  const { token, name } = useSession();

  const [items, setItems] = useState<ItemView[]>([]);
  const [attempts, setAttempts] = useState<AttemptView[]>([]);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishItem, setPublishItem] = useState<ItemView | null>(null);
  const [markBusy, setMarkBusy] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const markReady = useCallback(
    async (item: ItemView) => {
      if (!item.draftId) return;
      setMarkBusy(item.id);
      setMarkError(null);
      try {
        await api.draftAction(token, item.draftId, "approve");
        reload();
      } catch (e) {
        setMarkError((e as { error?: string })?.error ?? "Could not mark this listing ready.");
      } finally {
        setMarkBusy(null);
      }
    },
    [token, reload],
  );

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const [itemsRes, historyRes, channelsRes] = await Promise.all([
          api.listItems(token),
          api.getHistory(token),
          api.getChannels(token),
        ]);
        if (!active) return;
        setItems(itemsRes.items);
        setAttempts(historyRes.attempts);
        setChannels(channelsRes);
        setError(null);
      } catch (e) {
        if (active) {
          setError((e as { error?: string })?.error ?? "Failed to load dashboard");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const activeCount = items.filter((i) => i.lifecycleState === "active").length;
  // Only truly publishable items (approved AND passing server readiness) count
  // as ready, so the dashboard never advertises an item the publish flow would
  // reject. Mirrors the inventory "Ready" tab exactly.
  const readyItems = useMemo(() => items.filter(isPublishReady), [items]);
  const draftItems = useMemo(
    () => items.filter((i) => i.lifecycleState === "draft"),
    [items],
  );
  const failedItems = useMemo(
    () => items.filter((i) => i.lifecycleState === "error"),
    [items],
  );
  // Items approved before a field became required (lifecycle "ready" but
  // readiness now fails) — surfaced as needs-attention, never as ready.
  const regressedItems = useMemo(
    () => items.filter((i) => i.lifecycleState === "ready" && !i.ready),
    [items],
  );
  // Drafts that still need fields vs drafts that are complete but not yet
  // marked ready. Only the former belong in "Needs attention"; the latter get
  // a one-click "Mark ready" so a finished listing is never a dead end.
  const incompleteDrafts = useMemo(
    () => draftItems.filter((i) => !i.ready),
    [draftItems],
  );
  const completeDrafts = useMemo(
    () => draftItems.filter((i) => i.ready),
    [draftItems],
  );

  // Reset picked selection whenever the ready set changes, using React's
  // render-phase derived-state pattern (no effect needed).
  const readySig = readyItems.map((i) => i.id).join(",");
  const [pickedSig, setPickedSig] = useState<string | null>(null);
  if (readySig !== pickedSig) {
    setPickedSig(readySig);
    setPicked(new Set(readyItems.map((i) => i.id)));
  }

  const attention: AttentionRow[] = useMemo(() => {
    const fromFailed: AttentionRow[] = failedItems.map((i) => ({
      id: `err-${i.id}`,
      itemId: i.id,
      title: `Needs attention — ${i.title}`,
      sub: `${i.statusLabel} · couldn't finish`,
      tone: "miss",
    }));
    const fromDrafts: AttentionRow[] = incompleteDrafts.map((i) => ({
      id: `draft-${i.id}`,
      itemId: i.id,
      title: `Finish draft — ${i.title}`,
      sub:
        i.missingCount > 0
          ? `${i.missingCount} detail${i.missingCount === 1 ? "" : "s"} to add`
          : "Add details",
      tone: "warn",
    }));
    const fromRegressed: AttentionRow[] = regressedItems.map((i) => ({
      id: `regressed-${i.id}`,
      itemId: i.id,
      title: `Finish listing — ${i.title}`,
      sub:
        i.missingCount > 0
          ? `${i.missingCount} required detail${i.missingCount === 1 ? "" : "s"} missing`
          : "Required details missing",
      tone: "warn",
    }));
    return [...fromFailed, ...fromRegressed, ...fromDrafts];
  }, [failedItems, regressedItems, incompleteDrafts]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openPublish = () => {
    const target =
      readyItems.find((i) => picked.has(i.id)) ?? readyItems[0] ?? null;
    if (!target) return;
    setPublishItem(target);
    setPublishOpen(true);
  };

  if (loading)
    return (
      <>
        <Topbar crumbs={["Dashboard"]} />
        <PageSkeleton />
      </>
    );
  if (error)
    return (
      <>
        <Topbar crumbs={["Dashboard"]} />
        <main className="page">
          <ErrorState message={error} onRetry={reload} />
        </main>
      </>
    );

  const firstName = firstWord(name);
  const timeofday = greetingForHour(new Date().getHours());
  const pickedReadyCount = readyItems.filter((i) => picked.has(i.id)).length;

  return (
    <>
      <Topbar
        crumbs={["Dashboard"]}
        right={
          <Btn
            variant="accent"
            size="sm"
            icon="plus"
            onClick={() => router.push("/inventory/new")}
          >
            New listing
          </Btn>
        }
      />

      <main className="page">
        <div className="page__head">
          <div className="page__title-row">
            <h1 className="page__title">
              Good {timeofday}, <em>{firstName}</em>.
            </h1>
            <div className="page__title-meta">
              {readyItems.length} ready · {attention.length} need attention
            </div>
          </div>
          <div className="page__actions">
            <Btn
              variant="ghost"
              size="sm"
              icon="history"
              onClick={() => router.push("/history")}
            >
              History
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              icon="box"
              onClick={() => router.push("/inventory")}
            >
              Inventory
            </Btn>
          </div>
        </div>

        <div className="kpis">
          <div className="kpi">
            <div className="kpi__label">Active listings</div>
            <div className="kpi__value t-num">{activeCount}</div>
            <div className="kpi__sub">{items.length} total items</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Ready to publish</div>
            <div className="kpi__value t-num">{readyItems.length}</div>
            <div className="kpi__sub">Approved drafts</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Drafts</div>
            <div className="kpi__value t-num">{draftItems.length}</div>
            <div className="kpi__sub">In progress</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Needs attention</div>
            <div className="kpi__value t-num">{attention.length}</div>
            <div className="kpi__sub">
              {attention.length > 0 ? (
                <span className="kpi__delta--down">
                  <Icon name="arrow-dn" size={12} /> action needed
                </span>
              ) : (
                "All clear"
              )}
            </div>
          </div>
        </div>

        <div className="dash-grid">
          <div className="stack-6">
            <section className="card">
              <div className="card__head">
                <div className="row">
                  <span className="card__title">Needs your attention</span>
                  <span className="count-pill">{attention.length}</span>
                </div>
              </div>
              <div>
                {attention.length === 0 ? (
                  <div className="attn-row" style={{ cursor: "default" }}>
                    <span className="attn-row__icon attn-row__icon--done">
                      <Icon name="check-c" size={16} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="attn-row__title">
                        You&apos;re all caught up.
                      </div>
                      <div className="attn-row__sub">
                        No drafts or failures need a look right now.
                      </div>
                    </div>
                  </div>
                ) : (
                  attention.map((row) => (
                    <div
                      key={row.id}
                      className="attn-row"
                      onClick={() => router.push(`/inventory/${row.itemId}`)}
                    >
                      <span
                        className={`attn-row__icon attn-row__icon--${row.tone}`}
                      >
                        <Icon name={row.tone === "miss" ? "x-c" : "warn"} size={16} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="attn-row__title">{row.title}</div>
                        <div className="attn-row__sub">{row.sub}</div>
                      </div>
                      <Btn variant="ghost" size="sm" iconRight="chevR">
                        Open
                      </Btn>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <span className="card__title">Ready to publish</span>
                <Btn
                  variant="accent"
                  size="sm"
                  icon="send"
                  disabled={readyItems.length === 0}
                  onClick={openPublish}
                >
                  Publish {pickedReadyCount || readyItems.length}
                </Btn>
              </div>
              {markError && (
                <div className="card__body">
                  <span className="t-small danger">{markError}</span>
                </div>
              )}
              {completeDrafts.length > 0 && (
                <div>
                  {completeDrafts.map((item) => (
                    <div
                      key={item.id}
                      className="attn-row"
                      style={{ gridTemplateColumns: "44px 1fr auto auto" }}
                    >
                      <Thumb seed={item.id} size={44} />
                      <div
                        style={{ minWidth: 0, cursor: "pointer" }}
                        onClick={() => router.push(`/inventory/${item.id}`)}
                      >
                        <div className="attn-row__title">{item.title}</div>
                        <div className="attn-row__sub">Complete · mark ready to publish</div>
                      </div>
                      <span className="t-num" style={{ fontSize: 13, fontWeight: 500 }}>
                        {formatMoneyCents(item.priceCents)}
                      </span>
                      <Btn
                        variant="secondary"
                        size="sm"
                        icon="check"
                        disabled={markBusy === item.id}
                        onClick={() => void markReady(item)}
                      >
                        {markBusy === item.id ? "Marking…" : "Mark ready"}
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
              {readyItems.length === 0 && completeDrafts.length === 0 ? (
                <div className="card__body">
                  <EmptyState
                    icon="check-c"
                    title="Nothing ready yet"
                    desc="Finish a draft and mark it ready, and it shows up here to publish."
                  />
                </div>
              ) : (
                <div>
                  {readyItems.map((item) => (
                    <div
                      key={item.id}
                      className="attn-row"
                      style={{
                        gridTemplateColumns: "20px 44px 1fr auto auto",
                      }}
                      onClick={() => router.push(`/inventory/${item.id}`)}
                    >
                      <Check
                        checked={picked.has(item.id)}
                        onChange={() => togglePick(item.id)}
                      />
                      <Thumb seed={item.id} size={44} />
                      <div style={{ minWidth: 0 }}>
                        <div className="attn-row__title">{item.title}</div>
                        <div className="attn-row__sub">
                          {[item.brand, item.size].filter(Boolean).join(" · ") ||
                            "No details"}
                        </div>
                      </div>
                      <MpDots channels={item.channels} />
                      <div style={{ textAlign: "right" }}>
                        <div className="t-num" style={{ fontSize: 13, fontWeight: 500 }}>
                          {formatMoneyCents(item.priceCents)}
                        </div>
                        <div className="t-small t-num">
                          est {formatMoneyCents(estPayoutCents(item.priceCents))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="stack-6">
            <section className="card">
              <div className="card__head">
                <span className="card__title">Marketplace health</span>
              </div>
              <div>
                {channels.length === 0 ? (
                  <div className="health-row" style={{ cursor: "default" }}>
                    <span className="health-dot" />
                    <div className="mp-row__name">No channels configured</div>
                    <span />
                  </div>
                ) : (
                  channels.map((ch) => (
                    <div
                      key={ch.marketplace}
                      className="health-row"
                      onClick={() => router.push("/channels")}
                    >
                      <MpLogo id={ch.marketplace} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <div className="mp-row__name">{ch.name}</div>
                        <div className="mp-row__meta">
                          {ch.capabilities.publish
                            ? "Publishing enabled"
                            : "Draft preview only"}
                        </div>
                      </div>
                      <span
                        className={`health-dot ${
                          ch.capabilities.draftPreview ? "health-dot--ok" : ""
                        }`}
                      />
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <span className="card__title">Recent activity</span>
              </div>
              <div>
                {attempts.length === 0 ? (
                  <div className="health-row" style={{ cursor: "default" }}>
                    <span className="health-dot" />
                    <div className="mp-row__name">No publish attempts yet.</div>
                    <span />
                  </div>
                ) : (
                  attempts.slice(0, 6).map((a) => (
                    <div
                      key={a.id}
                      className="health-row"
                      onClick={() => router.push("/history")}
                    >
                      <MpLogo id={a.marketplace} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <div className="mp-row__name">{a.itemTitle}</div>
                        <div className="mp-row__meta">{relativeTime(a.time)}</div>
                      </div>
                      <Badge status={a.status} />
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        item={publishItem}
        onPublished={reload}
      />
    </>
  );
}
