"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Badge, Btn, Banner } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { Topbar } from "@/components/app/topbar";
import { ErrorState, PageSkeleton } from "@/components/app/states";
import type { ChannelView, ItemView } from "@/lib/view/types";

type RoadmapRow = {
  title: string;
  state: "available" | "soon";
  desc: string;
};

const ROADMAP: RoadmapRow[] = [
  {
    title: "Draft preview",
    state: "available",
    desc: "Build and review listings per channel before anything goes live.",
  },
  {
    title: "Publishing",
    state: "soon",
    desc: "Push listings to live marketplaces. Not implemented yet, every attempt is logged.",
  },
  {
    title: "Inventory sync",
    state: "soon",
    desc: "Keep stock and status in sync across channels once integrations ship.",
  },
  {
    title: "CSV export",
    state: "soon",
    desc: "Export listings and history to CSV. Planned.",
  },
];

export default function ChannelsPage() {
  const { token } = useSession();

  const [channels, setChannels] = useState<ChannelView[] | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const [channelsRes, itemsRes] = await Promise.all([
          api.getChannels(token),
          api.listItems(token),
        ]);
        if (!active) return;
        setChannels(channelsRes);
        setItems(itemsRes.items);
        setError(null);
      } catch (e) {
        if (active) {
          setError((e as { error?: string })?.error ?? "Failed to load marketplaces.");
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const targetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      for (const ch of item.channels) {
        if (ch.status !== "draft") {
          counts[ch.marketplace] = (counts[ch.marketplace] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [items]);

  if (error) {
    return (
      <>
        <Topbar crumbs={["Marketplaces"]} />
        <main className="page">
          <ErrorState message={error} onRetry={reload} />
        </main>
      </>
    );
  }

  if (channels === null) return <PageSkeleton />;

  return (
    <>
      <Topbar
        crumbs={["Marketplaces"]}
        right={
          <Btn
            variant="primary"
            size="sm"
            icon="plus"
            disabled
            title="Coming soon"
          >
            Connect marketplace
          </Btn>
        }
      />

      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Marketplaces<em>.</em>
            </h1>
            <div className="page__title-meta">
              {channels.length} adapters · publishing not enabled yet · CSV later
            </div>
          </div>
        </div>

        <Banner
          variant="info"
          title="Draft-only today"
          desc="Adapters are in draft-preview mode. Publishing and inventory sync arrive when real marketplace integrations ship. Every publish attempt is logged."
        />

        <div className="channels-grid" style={{ marginTop: 16 }}>
          {channels.map((c) => {
            const count = targetCounts[c.marketplace] ?? 0;
            return (
              <div
                key={c.marketplace}
                className="card"
                style={{
                  padding: 18,
                  display: "grid",
                  gridTemplateColumns: "44px 1fr auto",
                  gap: 14,
                  alignItems: "start",
                }}
              >
                <MpLogo id={c.marketplace} size={44} />

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <div
                    className="row"
                    style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}
                  >
                    {c.capabilities.draftPreview && (
                      <Badge status="ready" label="Draft preview" />
                    )}
                    {c.capabilities.publish ? (
                      <Badge status="published" label="Publishing" />
                    ) : (
                      <Badge status="noimpl" label="Publish: not implemented" />
                    )}
                    {c.capabilities.inventorySync ? (
                      <Badge status="ready" label="Sync" />
                    ) : (
                      <Badge status="noimpl" label="Sync: soon" />
                    )}
                  </div>
                  <div className="t-small muted" style={{ marginTop: 8 }}>
                    {count > 0
                      ? `${count} items target this channel`
                      : "Connected (draft preview)"}
                  </div>
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="settings"
                    disabled
                    title="Coming soon"
                  />
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon="csv"
                    disabled
                    title="Coming soon"
                  >
                    CSV
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card__head">
            <span className="card__title">Roadmap</span>
          </div>
          <div className="card__body">
            <div className="stack-4">
              {ROADMAP.map((row) => (
                <div
                  key={row.title}
                  className="row"
                  style={{ gap: 10, alignItems: "baseline" }}
                >
                  <Badge
                    status={row.state === "available" ? "ready" : "noimpl"}
                    label={row.state === "available" ? "Available" : "Not yet"}
                  />
                  <div style={{ minWidth: 0 }}>
                    <span className="t-small" style={{ fontWeight: 500 }}>
                      {row.title}
                    </span>
                    <span className="t-small muted"> - {row.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
