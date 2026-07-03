"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Badge, Banner } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { Topbar } from "@/components/app/topbar";
import { ErrorState, PageSkeleton } from "@/components/app/states";
import { marketplaceCapabilityLabel } from "@/lib/view/marketplaces";
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
    title: "Live eBay publishing",
    state: "available",
    desc: "Live for selected alpha accounts. Gated by an allowlist and a global switch; every attempt is audited.",
  },
  {
    title: "StockX listing automation",
    state: "available",
    desc: "Create, activate, and end StockX listings after an exact catalog match and live confirmation.",
  },
  {
    title: "Sold-event sync",
    state: "soon",
    desc: "Marketplace sold webhooks are still gated by each platform's API access.",
  },
  {
    title: "CSV export",
    state: "available",
    desc: "Export your inventory to CSV from the Inventory page.",
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

  if (channels === null)
    return (
      <>
        <Topbar crumbs={["Marketplaces"]} />
        <PageSkeleton />
      </>
    );

  const ebayLive = channels.some(
    (c) => c.marketplace === "ebay" && c.capabilities.publish,
  );
  const stockxLive = channels.some(
    (c) => c.marketplace === "stockx" && c.capabilities.publish,
  );

  return (
    <>
      <Topbar
        crumbs={["Marketplaces"]}
        right={
          <Link
            href="/settings/marketplaces"
            className="btn btn--primary btn--sm"
          >
            Manage connections
          </Link>
        }
      />

      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Marketplaces<em>.</em>
            </h1>
            <div className="page__title-meta">
              {channels.length} channels ·{" "}
              {ebayLive
                ? "eBay live publishing enabled"
                : "eBay live publishing in alpha"}{" "}
              ·{" "}
              {stockxLive
                ? "StockX live API enabled"
                : "StockX catalog match required"}
            </div>
          </div>
        </div>

        <Banner
          variant="info"
          title="Marketplace automation is gated per channel"
          desc="eBay live publishing is enabled for selected alpha accounts. StockX can create, activate, and end live listings when the item has an exact catalog match and the seller confirms the live action."
        />

        <div className="channels-grid" style={{ marginTop: 16 }}>
          {channels.map((c) => {
            const count = targetCounts[c.marketplace] ?? 0;
            const isEbay = c.marketplace === "ebay";
            const isStockX = c.marketplace === "stockx";
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
                    {isEbay && c.capabilities.publish ? (
                      <Badge status="published" label="Live publishing" />
                    ) : (
                      <Badge
                        outline
                        label={marketplaceCapabilityLabel({
                          marketplace: c.marketplace,
                          publish: c.capabilities.publish,
                        })}
                      />
                    )}
                    {isStockX && c.capabilities.publish && (
                      <Badge outline label="Exact match required" />
                    )}
                    <Badge outline label={channelAutomationLabel(c)} />
                  </div>
                  <div className="t-small muted" style={{ marginTop: 8 }}>
                    {count > 0
                      ? `${count} items target this channel`
                      : emptyChannelSummary(c)}
                  </div>
                </div>

                <div className="row" style={{ gap: 6 }}>
                  {isEbay && (
                    <Link
                      href="/settings/marketplaces"
                      className="btn btn--ghost btn--sm"
                      title="Manage your eBay connection"
                    >
                      Manage
                    </Link>
                  )}
                  <Link
                    href="/inventory"
                    className="btn btn--secondary btn--sm"
                    title="Export your inventory to CSV"
                  >
                    Export
                  </Link>
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

function channelAutomationLabel(channel: ChannelView): string {
  if (channel.capabilities.delist) return "Auto delist ready";
  if (channel.capabilities.inventorySync) return "Inventory sync ready";
  return "Inventory sync pending";
}

function emptyChannelSummary(channel: ChannelView): string {
  if (channel.marketplace === "stockx") {
    return channel.capabilities.publish
      ? "Ready after exact StockX catalog match"
      : "Match each item to StockX before listing";
  }
  if (channel.capabilities.publish) return "Live publishing available";
  return "Connected for draft review";
}
