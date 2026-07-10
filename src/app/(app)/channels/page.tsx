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
          </div>
        </div>

        {channels.length === 0 ? (
          <div className="empty" style={{ marginTop: 16 }}>
            <div className="empty__art">
              <Icon name="store" size={36} />
            </div>
            <p className="empty__title">No channels yet<em>.</em></p>
            <p className="empty__desc">
              Connect eBay to publish listings directly. Other marketplaces use
              assisted listing packages you post yourself.
            </p>
            <Link href="/settings/marketplaces" className="btn btn--primary btn--sm">
              Connect a marketplace
            </Link>
          </div>
        ) : (
          <div className="channels-grid" style={{ marginTop: 16 }}>
            {channels.map((c) => {
              const count = targetCounts[c.marketplace] ?? 0;
              const isEbay = c.marketplace === "ebay";
              return (
                <div
                  key={c.marketplace}
                  className="card channel-card"
                >
                  <MpLogo id={c.marketplace} size={44} />

                  <div className="channel-card__main">
                    <div className="channel-card__name">{c.name}</div>
                  </div>

                  <div className="channel-card__actions">
                    {count > 0 && (
                      <span className="channel-card__count t-num">{count}</span>
                    )}
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
                      title="View inventory"
                    >
                      Inventory
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
