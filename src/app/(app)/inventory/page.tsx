"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Topbar } from "@/components/app/topbar";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states";
import {
  BulkPublishModal,
  type BulkPublishPhase,
} from "@/components/app/bulk-publish-modal";
import {
  BulkDelistModal,
  type BulkDelistPhase,
} from "@/components/app/bulk-delist-modal";
import { Badge, Btn, Check, Tabs } from "@/components/ui/primitives";
import { MpDots, Thumb } from "@/components/ui/marketplace";
import { useFeatureAccess } from "@/components/providers/feature-access-provider";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import type {
  BulkExecutionResult,
  BulkPreflightResult,
} from "@/lib/marketplace/bulk-publish";
import type {
  BulkDelistExecutionResult,
  BulkDelistPreflightResult,
} from "@/lib/marketplace/bulk-delist";
import { matchesItemSearch } from "@/lib/view/inventory-actions";
import { inventoryDisplayBucket } from "@/lib/view/item-readiness-bucket";
import type { ItemLifecycleState } from "@/lib/lifecycle/item-status";
import {
  conditionLabel,
  formatMoneyCents,
  relativeTime,
} from "@/lib/view/format";
import { SORT_OPTIONS, sortItems, type SortValue } from "@/lib/view/sort-items";
import { toCsv } from "@/lib/view/csv";
import type { ItemView } from "@/lib/view/types";
import type { ChannelView } from "@/lib/view/types";

type TabValue = "all" | "draft" | "ready" | "active" | "sold" | "error";

const TAB_LABEL: Record<TabValue, string> = {
  all: "All",
  draft: "Drafts",
  ready: "Ready",
  active: "Active",
  sold: "Sold",
  error: "Needs attention",
};

const PAGE_SIZE = 24;

export default function InventoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useSession();
  const { access, copy, limits } = useFeatureAccess();
  const bulkBatchLimit = Math.min(10, limits.bulkBatchSize);

  const [items, setItems] = useState<ItemView[] | null>(null);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabValue>("all");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortValue>("updated_desc");
  const [view, setView] = useState<"list" | "grid">("grid");
  const [page, setPage] = useState(1);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bulk eBay publish: preflight on open, gate execution behind explicit
  // confirmation, keep per-item results until the modal closes.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkMarketplace, setBulkMarketplace] = useState<"ebay" | "stockx">("ebay");
  const [bulkPhase, setBulkPhase] = useState<BulkPublishPhase>("preflight");
  const [bulkPreflight, setBulkPreflight] = useState<BulkPreflightResult | null>(null);
  const [bulkExecution, setBulkExecution] = useState<BulkExecutionResult | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Bulk eBay end/delist: same preflight -> confirm -> execute flow as publish.
  const [delistOpen, setDelistOpen] = useState(false);
  const [delistIds, setDelistIds] = useState<string[]>([]);
  const [delistMarketplace, setDelistMarketplace] = useState<"ebay" | "stockx">("ebay");
  const [delistPhase, setDelistPhase] = useState<BulkDelistPhase>("preflight");
  const [delistPreflight, setDelistPreflight] = useState<BulkDelistPreflightResult | null>(null);
  const [delistExecution, setDelistExecution] = useState<BulkDelistExecutionResult | null>(null);
  const [delistConfirm, setDelistConfirm] = useState(false);
  const [delistError, setDelistError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const [res, channelRows] = await Promise.all([
          api.listItems(token),
          api.getChannels(token),
        ]);
        if (!active) return;
        setItems(res.items);
        setChannels(channelRows);
        setLoadError(null);
      } catch (e) {
        if (active) {
          setLoadError((e as { error?: string })?.error ?? "Failed to load inventory.");
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const counts = useMemo(() => {
    const base: Record<ItemLifecycleState, number> = {
      draft: 0,
      ready: 0,
      active: 0,
      sold: 0,
      delisted: 0,
      error: 0,
    };
    // Bucket by display readiness, not raw lifecycle, so an approved-but-not-
    // ready item counts under "Needs attention", matching the dashboard.
    for (const it of items ?? []) base[inventoryDisplayBucket(it)] += 1;
    return base;
  }, [items]);

  const hasSold = counts.sold > 0;

  const tabItems = useMemo(() => {
    const all = items?.length ?? 0;
    const base = [
      { value: "all", label: TAB_LABEL.all, count: all },
      { value: "draft", label: TAB_LABEL.draft, count: counts.draft },
      { value: "ready", label: TAB_LABEL.ready, count: counts.ready },
      { value: "active", label: TAB_LABEL.active, count: counts.active },
    ];
    if (hasSold) {
      base.push({ value: "sold", label: TAB_LABEL.sold, count: counts.sold });
    }
    base.push({ value: "error", label: TAB_LABEL.error, count: counts.error });
    return base;
  }, [items, counts, hasSold]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const byTab =
      tab === "all" ? list : list.filter((it) => inventoryDisplayBucket(it) === tab);
    const matched = byTab.filter((it) => matchesItemSearch(it, search.trim()));
    return sortItems(matched, sort);
  }, [items, tab, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp the page when the result set shrinks (render-phase derived state).
  const safePage = Math.min(page, pageCount);
  if (safePage !== page) setPage(safePage);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const allSelected =
    paged.length > 0 && paged.every((item) => selected.has(item.id));

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (paged.length > 0 && paged.every((it) => prev.has(it.id))) {
        const next = new Set(prev);
        for (const it of paged) next.delete(it.id);
        return next;
      }
      const next = new Set(prev);
      for (const it of paged) next.add(it.id);
      return next;
    });
  }, [paged]);

  const exportCsv = useCallback(() => {
    const rows = (items ?? []).filter((it) => selected.has(it.id));
    if (!rows.length) return;
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${rows.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [items, selected]);

  const deleteSelected = useCallback(async () => {
    const ids = (items ?? []).filter((it) => selected.has(it.id)).map((it) => it.id);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await api.deleteItems(token, ids);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
      if (result.blocked.length > 0) {
        const n = result.blocked.length;
        setActionError(
          `${n} item${n === 1 ? "" : "s"} kept: end the live eBay listing before deleting.`,
        );
      }
    } catch (e) {
      setActionError((e as { error?: string })?.error ?? "Could not delete items.");
    } finally {
      setActionBusy(false);
    }
  }, [items, selected, token]);

  const setPriceSelected = useCallback(async () => {
    const ids = (items ?? []).filter((it) => selected.has(it.id)).map((it) => it.id);
    if (!ids.length) return;
    const input = window.prompt(`Set price (USD) for ${ids.length} item${ids.length === 1 ? "" : "s"}:`, "");
    if (input == null) return;
    const dollars = Number(input.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setActionError("Enter a valid price above $0.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await api.setBulkPrice(token, ids, Math.round(dollars * 100));
      setReloadKey((k) => k + 1);
    } catch (e) {
      setActionError((e as { error?: string })?.error ?? "Could not set price.");
    } finally {
      setActionBusy(false);
    }
  }, [items, selected, token]);

  const openBulkPublish = useCallback((marketplace: "ebay" | "stockx" = "ebay") => {
    const ids = (items ?? []).filter((it) => selected.has(it.id)).map((it) => it.id);
    if (!ids.length) return;
    if (ids.length > bulkBatchLimit) {
      setActionError(
        `Your plan allows up to ${bulkBatchLimit} items per bulk action.`,
      );
      return;
    }
    setBulkMarketplace(marketplace);
    setBulkIds(ids);
    setBulkPreflight(null);
    setBulkExecution(null);
    setBulkConfirm(false);
    setBulkError(null);
    setBulkPhase("preflight");
    setBulkOpen(true);
  }, [items, bulkBatchLimit, selected]);

  // Preflight the selection when the modal opens. Read-only; no outbound eBay
  // write happens here. State is set only inside the async runner after await.
  useEffect(() => {
    if (!bulkOpen || bulkIds.length === 0) return;
    let active = true;
    async function run() {
      try {
        const result = await api.preflightBulkPublish(token, bulkIds, bulkMarketplace);
        if (active) {
          setBulkPreflight(result);
          setBulkPhase("ready");
        }
      } catch (e) {
        if (active) {
          setBulkError(
            (e as { error?: string })?.error ?? "Could not check the selected items.",
          );
          setBulkPhase("ready");
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [bulkOpen, bulkIds, bulkMarketplace, token]);

  const runBulkPublish = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setBulkPhase("running");
      setBulkError(null);
      try {
        const result = await api.executeBulkPublish(token, ids, bulkMarketplace);
        setBulkExecution(result);
        setBulkPhase("result");
        setReloadKey((k) => k + 1);
      } catch (e) {
        setBulkError((e as { error?: string })?.error ?? "Bulk publish failed.");
        setBulkPhase("ready");
      }
    },
    [bulkMarketplace, token],
  );

  const executeBulkPublish = useCallback(() => {
    if (!bulkConfirm) return;
    const readyIds = (bulkPreflight?.items ?? [])
      .filter((i) => i.status === "ready")
      .map((i) => i.itemId);
    void runBulkPublish(readyIds);
  }, [bulkConfirm, bulkPreflight, runBulkPublish]);

  const openBulkDelist = useCallback((marketplace: "ebay" | "stockx" = "ebay") => {
    const ids = (items ?? []).filter((it) => selected.has(it.id)).map((it) => it.id);
    if (!ids.length) return;
    if (ids.length > bulkBatchLimit) {
      setActionError(
        `Your plan allows up to ${bulkBatchLimit} items per bulk action.`,
      );
      return;
    }
    setDelistMarketplace(marketplace);
    setDelistIds(ids);
    setDelistPreflight(null);
    setDelistExecution(null);
    setDelistConfirm(false);
    setDelistError(null);
    setDelistPhase("preflight");
    setDelistOpen(true);
  }, [items, bulkBatchLimit, selected]);

  // Read-only bulk delist preflight on open; no outbound eBay write here.
  useEffect(() => {
    if (!delistOpen || delistIds.length === 0) return;
    let active = true;
    async function run() {
      try {
        const result = await api.preflightBulkDelist(token, delistIds, delistMarketplace);
        if (active) {
          setDelistPreflight(result);
          setDelistPhase("ready");
        }
      } catch (e) {
        if (active) {
          setDelistError(
            (e as { error?: string })?.error ?? "Could not check the selected items.",
          );
          setDelistPhase("ready");
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [delistOpen, delistIds, delistMarketplace, token]);

  const runBulkDelist = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setDelistPhase("running");
      setDelistError(null);
      try {
        const result = await api.executeBulkDelist(token, ids, delistMarketplace);
        setDelistExecution(result);
        setDelistPhase("result");
        setReloadKey((k) => k + 1);
      } catch (e) {
        setDelistError((e as { error?: string })?.error ?? "Bulk end/delist failed.");
        setDelistPhase("ready");
      }
    },
    [delistMarketplace, token],
  );

  const executeBulkDelist = useCallback(() => {
    if (!delistConfirm) return;
    const eligibleIds = (delistPreflight?.items ?? [])
      .filter((i) => i.status === "eligible")
      .map((i) => i.itemId);
    void runBulkDelist(eligibleIds);
  }, [delistConfirm, delistPreflight, runBulkDelist]);

  if (loadError) {
    return (
      <>
        <Topbar crumbs={["Inventory"]} />
        <main className="page inventory-page">
          <ErrorState message={loadError} onRetry={reload} />
        </main>
      </>
    );
  }

  if (items === null) return <PageSkeleton />;

  const total = items.length;
  const selectionCount = (items ?? []).filter((item) => selected.has(item.id)).length;
  const selectionOverBulkLimit = selectionCount > bulkBatchLimit;
  const stockxChannel = channels.find((c) => c.marketplace === "stockx");
  const stockxBulkPublishEnabled = Boolean(stockxChannel?.capabilities.publish);
  const stockxBulkDelistEnabled = Boolean(stockxChannel?.capabilities.delist);
  const bulkTitles: Record<string, string> = {};
  for (const it of items) {
    if (bulkIds.includes(it.id) || delistIds.includes(it.id)) bulkTitles[it.id] = it.title;
  }

  const renderBody = () => {
    if (total === 0) {
      return (
        <EmptyState
          icon="package"
          title={
            <>
              Your inventory <em>is empty</em>
            </>
          }
          desc="Add your first item to start cross-listing."
          actions={
            <Btn
              variant="accent"
              icon="plus"
              onClick={() => router.push("/inventory/new")}
            >
              New listing
            </Btn>
          }
        />
      );
    }

    if (filtered.length === 0) {
      if (search.trim()) {
        return (
          <EmptyState
            icon="search"
            title={`No items match "${search.trim()}"`}
            actions={
              <Btn variant="secondary" onClick={() => setSearch("")}>
                Clear search
              </Btn>
            }
          />
        );
      }
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

    if (view === "grid") {
      return (
        <div className="inventory-grid">
          {paged.map((item) => {
            const isSelected = selected.has(item.id);
            const href = `/inventory/${item.id}`;
            return (
              <div
                key={item.id}
                className={`inventory-card ${isSelected ? "inventory-card--selected" : ""}`}
              >
                <div
                  className="inventory-card__select"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Check label={`Select ${item.title}`} checked={isSelected} onChange={() => toggleRow(item.id)} />
                </div>
                <Link href={href} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
                  <Thumb image={item.coverImage ?? null} size={240} className="inventory-card__photo" />
                  <div className="inventory-card__body">
                  <div className="table__product-title" style={{ marginTop: 10 }}>
                    {item.title}
                  </div>
                  <div className="table__product-meta">
                    {[item.brand, item.size].filter(Boolean).join(" · ")}
                  </div>
                  <div
                    className="row"
                    style={{ justifyContent: "space-between", marginTop: 10 }}
                  >
                    <Badge status={item.status} label={item.statusLabel} />
                    <span className="t-num">{formatMoneyCents(item.priceCents)}</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <MpDots channels={item.channels} />
                  </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="table-wrap inventory-table">
        <table className="table">
          <thead>
            <tr>
              <th className="table__check">
                <Check label="Select all items on this page" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Item</th>
              <th>Status</th>
              <th>Marketplaces</th>
              <th className="table__num">Price</th>
              <th className="table__num">Photos</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((item) => {
              const isSelected = selected.has(item.id);
              const href = `/inventory/${item.id}`;
              return (
                <tr
                  key={item.id}
                  className={isSelected ? "table__row--selected" : ""}
                >
                  <td className="table__check">
                    <Check
                      checked={isSelected}
                      label={`Select ${item.title}`}
                      onChange={() => toggleRow(item.id)}
                    />
                  </td>
                  <td>
                    <Link
                      href={href}
                      className="table__product"
                      style={{ display: "flex", color: "inherit", textDecoration: "none" }}
                    >
                      <Thumb image={item.coverImage ?? null} size={64} />
                      <div className="table__product-text">
                        <div className="table__product-title">{item.title}</div>
                        <div className="table__product-meta">
                          {[
                            item.brand,
                            item.size,
                            conditionLabel(item.condition),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td data-label="Status"><Badge status={item.status} label={item.statusLabel} /></td>
                  <td data-label="Marketplaces"><MpDots channels={item.channels} /></td>
                  <td data-label="Price" className="table__num">{formatMoneyCents(item.priceCents)}</td>
                  <td data-label="Photos" className="table__num">{item.photoCount}</td>
                  <td data-label="Updated"><span className="muted">{relativeTime(item.updatedAt)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <Topbar crumbs={["Inventory"]} />
      <main className="page inventory-page">
        <div className="page__head">
          <div className="page__title-row">

            <h1 className="page__title">Your inventory<span className="title-count">{total}</span></h1>
            <p className="page__title-meta">Every item, from first photo to final sale.</p>
          </div>
          <Btn variant="accent" icon="plus" size="lg" onClick={() => router.push("/inventory/new")}>Add an item</Btn>
        </div>
        <div className="toolbar inventory-filters">
          <Tabs
            items={tabItems}
            value={tab}
            onChange={(v) => {
              setTab(v as TabValue);
              setPage(1);
            }}
          />
          <div className="spacer" />
          <input
            className="input-search"
            type="search"
            aria-label="Search inventory"
            placeholder="Search your inventory…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <div className="inventory-sort"><select
            className="select"
            style={{ width: "auto" }}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortValue);
              setPage(1);
            }}
            aria-label="Sort"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select></div>
          <Tabs
            items={[
              { value: "list", label: "List" },
              { value: "grid", label: "Grid" },
            ]}
            value={view}
            onChange={(v) => setView(v as "list" | "grid")}
          />
        </div>

        <div className={`toolbar inventory-selection ${selectionCount ? "inventory-selection--active" : ""}`}>
          <Check label="Select all items on this page" checked={allSelected} onChange={toggleAll} />
          <span className="toolbar__count">
            {selectionCount > 0
              ? `${selectionCount} selected`
              : `${filtered.length} of ${total}`}
          </span>
          {selectionCount > 0 && <span className="t-small muted">Up to {bulkBatchLimit} per batch</span>}
          {selectionOverBulkLimit && (
            <span className="t-small danger">
              Select {bulkBatchLimit} or fewer for bulk actions.
            </span>
          )}
          {selectionCount > 0 && stockxBulkPublishEnabled && (
            <span className="t-small muted">
              StockX requires exact product + size match.
            </span>
          )}
          {selectionCount > 0 && <div className="toolbar__divider" />}
          {selectionCount > 0 ? (
            <div className="toolbar__group">
              <Btn
                variant="secondary"
                icon="send"
                onClick={() => openBulkPublish("ebay")}
                disabled={selectionCount === 0 || selectionOverBulkLimit}
              >
                {access.liveEbayPublish ? "Publish selected to eBay" : "Preview selected"}
              </Btn>
              {stockxBulkPublishEnabled && (
                <Btn
                  variant="secondary"
                  icon="send"
                  onClick={() => openBulkPublish("stockx")}
                  disabled={selectionCount === 0 || selectionOverBulkLimit}
                >
                  Publish selected to StockX
                </Btn>
              )}
              <Btn
                variant="secondary"
                icon="pause"
                onClick={() => openBulkDelist("ebay")}
                disabled={selectionCount === 0 || selectionOverBulkLimit}
              >
                {access.ebayDelist ? "End on eBay" : "Review ending"}
              </Btn>
              {stockxBulkDelistEnabled && (
                <Btn
                  variant="secondary"
                  icon="pause"
                  onClick={() => openBulkDelist("stockx")}
                  disabled={selectionCount === 0 || selectionOverBulkLimit}
                >
                  Delist selected from StockX
                </Btn>
              )}
              <Btn variant="secondary" icon="tag" onClick={setPriceSelected} disabled={actionBusy}>
                Set price
              </Btn>
              <Btn variant="secondary" icon="download" onClick={exportCsv} disabled={actionBusy}>
                Export CSV
              </Btn>
              <Btn variant="secondary" icon="trash" onClick={deleteSelected} disabled={actionBusy}>
                Delete
              </Btn>
            </div>
          ) : (
            <Btn
              variant="ghost"
              icon="refresh"
              onClick={reload}
              title="Refresh"
            >
              Refresh
            </Btn>
          )}
          <div className="spacer" />
          {actionError && <span className="t-small danger">{actionError}</span>}
        </div>

        {renderBody()}

        {filtered.length > PAGE_SIZE && (
          <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
            <span className="t-small muted">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <Btn
                variant="secondary"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Btn>
              <span className="t-small muted">
                Page {safePage} of {pageCount}
              </span>
              <Btn
                variant="secondary"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </main>

      <BulkPublishModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        selectionCount={bulkIds.length}
        batchLimit={bulkBatchLimit}
        livePublishAllowed={
          bulkMarketplace === "stockx" ? stockxBulkPublishEnabled : access.liveEbayPublish
        }
        alphaCopy={
          bulkMarketplace === "stockx"
            ? "StockX bulk publishing requires exact product and size matches."
            : copy.liveEbayPublish
        }
        marketplace={bulkMarketplace}
        phase={bulkPhase}
        preflight={bulkPreflight}
        execution={bulkExecution}
        confirmLive={bulkConfirm}
        onConfirmChange={setBulkConfirm}
        onExecute={executeBulkPublish}
        onRetry={runBulkPublish}
        error={bulkError}
        itemTitles={bulkTitles}
      />
      <BulkDelistModal
        open={delistOpen}
        onClose={() => setDelistOpen(false)}
        selectionCount={delistIds.length}
        batchLimit={bulkBatchLimit}
        liveDelistAllowed={
          delistMarketplace === "stockx" ? stockxBulkDelistEnabled : access.ebayDelist
        }
        alphaCopy={
          delistMarketplace === "stockx"
            ? "StockX delist uses the connected seller account and audited cleanup fallback."
            : copy.ebayDelist
        }
        marketplace={delistMarketplace}
        phase={delistPhase}
        preflight={delistPreflight}
        execution={delistExecution}
        confirmLive={delistConfirm}
        onConfirmChange={setDelistConfirm}
        onExecute={executeBulkDelist}
        onRetry={runBulkDelist}
        error={delistError}
        itemTitles={bulkTitles}
      />
    </>
  );
}
