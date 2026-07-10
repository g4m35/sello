"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { MpLogo } from "@/components/ui/marketplace";
import { Topbar } from "@/components/app/topbar";
import { ErrorState, PageSkeleton } from "@/components/app/states";
import { Icon } from "@/components/ui/icon";
import type { ChannelView, ItemView } from "@/lib/view/types";

const CHANNEL_ORDER = ["ebay", "stockx", "etsy"] as const;

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

  const orderedChannels = useMemo(() => {
    if (!channels) return [];
    const rank = new Map(CHANNEL_ORDER.map((id, i) => [id, i]));
    return [...channels].sort((a, b) => {
      const ai = rank.get(a.marketplace as (typeof CHANNEL_ORDER)[number]) ?? 99;
      const bi = rank.get(b.marketplace as (typeof CHANNEL_ORDER)[number]) ?? 99;
      return ai - bi;
    });
  }, [channels]);

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
          <Link href="/settings/marketplaces" className="btn btn--primary btn--sm">
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
              Status across channels. Connect and manage accounts in one place.
            </div>
          </div>
        </div>

        {orderedChannels.length === 0 ? (
          <div className="empty" style={{ marginTop: 16 }}>
            <div className="empty__art">
              <Icon name="store" size={36} />
            </div>
            <p className="empty__title">No channels yet<em>.</em></p>
            <p className="empty__desc">
              Connect eBay, StockX, or Etsy to price and publish from one place.
            </p>
            <Link href="/settings/marketplaces" className="btn btn--primary btn--sm">
              Connect a marketplace
            </Link>
          </div>
        ) : (
          <div className="channels-grid" style={{ marginTop: 16 }}>
            {orderedChannels.map((c) => {
              const count = targetCounts[c.marketplace] ?? 0;
              return (
                <div key={c.marketplace} className="card channel-card">
                  <MpLogo id={c.marketplace} size={40} />
                  <div className="channel-card__main">
                    <div className="channel-card__name">{c.name}</div>
                    <div className="t-small muted" style={{ marginTop: 2 }}>
                      {count > 0
                        ? `${count} listing${count === 1 ? "" : "s"} on this channel`
                        : "No live listings yet"}
                    </div>
                  </div>
                  {count > 0 && (
                    <span className="channel-card__count t-num">{count}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
