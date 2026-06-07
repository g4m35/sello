"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Badge, Btn, Check } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MpLogo, MpDots, Thumb } from "@/components/ui/marketplace";
import { Topbar } from "@/components/app/topbar";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states";
import { PublishModal } from "@/components/app/publish-modal";
import { ImportModal } from "@/components/app/import-modal";
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
  const [importOpen, setImportOpen] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

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
  const readyItems = useMemo(
    () => items.filter((i) => i.lifecycleState === "ready"),
    [items],
  );
  const draftItems = useMemo(
    () => items.filter((i) => i.lifecycleState === "draft"),
    [items],
  );
  const failedItems = useMemo(
    () => items.filter((i) => i.lifecycleState === "error"),
    [items],
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
      title: `Needs attention - ${i.title}`,
      sub: `${i.statusLabel} · publish failed`,
      tone: "miss",
    }));
    const fromDrafts: AttentionRow[] = draftItems.map((i) => ({
      id: `draft-${i.id}`,
      itemId: i.id,
      title: `Finish draft - ${i.title}`,
      sub: "Draft · add details",
      tone: "warn",
    }));
    return [...fromFailed, ...fromDrafts];
  }, [failedItems, draftItems]);

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

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const firstName = firstWord(name);
  const timeofday = greetingForHour(new Date().getHours());
  const pickedReadyCount = readyItems.filter((i) => picked.has(i.id)).length;

  return (
    <>
      <Topbar
        crumbs={["Dashboard"]}
        right={
          <>
            <Btn
              variant="secondary"
              size="sm"
              icon="csv"
              onClick={() => setImportOpen(true)}
            >
              Import CSV
            </Btn>
            <Btn
              variant="accent"
              size="sm"
              icon="plus"
              onClick={() => router.push("/inventory/new")}
            >
              New listing
            </Btn>
          </>
        }
      />

      <main className="page">
        <div className="page__head">
          <div className="page__title-row">
            <h1 className="page__title">
              Good {timeofday}, <em>{firstName}</em>.
            </h1>
            <div className="page__title-meta">
              {readyItems.length} ready · {failedItems.length} need attention
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
            <div className="kpi__value t-num">{failedItems.length}</div>
            <div className="kpi__sub">
              {failedItems.length > 0 ? (
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
              {readyItems.length === 0 ? (
                <div className="card__body">
                  <EmptyState
                    icon="check-c"
                    title="Nothing ready yet"
                    desc="Approve a draft and it shows up here, ready to publish."
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
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => router.push("/inventory")}
      />
    </>
  );
}
