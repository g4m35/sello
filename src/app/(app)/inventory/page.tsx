"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Topbar } from "@/components/app/topbar";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/app/states";
import { PublishModal } from "@/components/app/publish-modal";
import { ImportModal } from "@/components/app/import-modal";
import { Badge, Btn, Check, Tabs } from "@/components/ui/primitives";
import { MpDots, Thumb } from "@/components/ui/marketplace";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import type { ItemLifecycleState } from "@/lib/lifecycle/item-status";
import {
  conditionLabel,
  formatMoneyCents,
  relativeTime,
} from "@/lib/view/format";
import type { ItemView } from "@/lib/view/types";

type TabValue = "all" | "draft" | "ready" | "active" | "sold" | "error";

const TAB_LABEL: Record<TabValue, string> = {
  all: "All",
  draft: "Drafts",
  ready: "Ready",
  active: "Active",
  sold: "Sold",
  error: "Needs attention",
};

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: ItemView[]): string {
  const header = [
    "id", "title", "brand", "category", "condition", "size", "color",
    "price_usd", "status", "photos", "updated_at",
  ];
  const lines = [header.join(",")];
  for (const it of rows) {
    lines.push(
      [
        it.id, it.title, it.brand ?? "", it.category, it.condition, it.size ?? "",
        it.colorway ?? "",
        it.priceCents != null ? (it.priceCents / 100).toFixed(2) : "",
        it.statusLabel, it.photoCount, it.updatedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

function matchesSearch(item: ItemView, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [item.title, item.brand ?? "", item.id]
    .some((field) => field.toLowerCase().includes(needle));
}

export default function InventoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useSession();

  const [items, setItems] = useState<ItemView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabValue>("all");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importOpen, setImportOpen] = useState(false);
  const [publishItem, setPublishItem] = useState<ItemView | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await api.listItems(token);
        if (!active) return;
        setItems(res.items);
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
    for (const it of items ?? []) base[it.lifecycleState] += 1;
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
      tab === "all" ? list : list.filter((it) => it.lifecycleState === tab);
    return byTab.filter((it) => matchesSearch(it, search.trim()));
  }, [items, tab, search]);

  const filteredIds = useMemo(
    () => new Set(filtered.map((it) => it.id)),
    [filtered],
  );

  const selectedInView = useMemo(
    () => [...selected].filter((id) => filteredIds.has(id)),
    [selected, filteredIds],
  );

  const allSelected =
    filtered.length > 0 && selectedInView.length === filtered.length;

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
      if (filtered.length > 0 && filtered.every((it) => prev.has(it.id))) {
        const next = new Set(prev);
        for (const it of filtered) next.delete(it.id);
        return next;
      }
      const next = new Set(prev);
      for (const it of filtered) next.add(it.id);
      return next;
    });
  }, [filtered]);

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
      await api.deleteItems(token, ids);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
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

  if (loadError) {
    return (
      <>
        <Topbar crumbs={["Inventory"]} />
        <main className="page">
          <ErrorState message={loadError} onRetry={reload} />
        </main>
      </>
    );
  }

  if (items === null) return <PageSkeleton />;

  const total = items.length;
  const selectionCount = selectedInView.length;
  const firstSelected =
    selectionCount > 0
      ? items.find((it) => it.id === selectedInView[0]) ?? null
      : null;

  const topbarRight = (
    <>
      <Btn variant="secondary" icon="csv" onClick={() => setImportOpen(true)}>
        Import CSV
      </Btn>
      <Btn variant="accent" icon="plus" onClick={() => router.push("/inventory/new")}>
        New listing
      </Btn>
    </>
  );

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
            <>
              <Btn
                variant="accent"
                icon="plus"
                onClick={() => router.push("/inventory/new")}
              >
                New listing
              </Btn>
              <Btn
                variant="secondary"
                icon="csv"
                onClick={() => setImportOpen(true)}
              >
                Import CSV
              </Btn>
            </>
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

    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__check">
                <Check checked={allSelected} onChange={toggleAll} />
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
            {filtered.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <tr
                  key={item.id}
                  className={isSelected ? "table__row--selected" : ""}
                  onClick={() => router.push(`/inventory/${item.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td className="table__check" onClick={(e) => e.stopPropagation()}>
                    <Check
                      checked={isSelected}
                      onChange={() => toggleRow(item.id)}
                    />
                  </td>
                  <td>
                    <div className="table__product">
                      <Thumb seed={item.id} />
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
                    </div>
                  </td>
                  <td>
                    <Badge status={item.status} label={item.statusLabel} />
                  </td>
                  <td>
                    <MpDots channels={item.channels} />
                  </td>
                  <td className="table__num">
                    {formatMoneyCents(item.priceCents)}
                  </td>
                  <td className="table__num">{item.photoCount}</td>
                  <td>
                    <span className="muted">{relativeTime(item.updatedAt)}</span>
                  </td>
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
      <Topbar crumbs={["Inventory"]} right={topbarRight} />
      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Inventory, <em>{total}</em> items
            </h1>
            <div className="page__title-meta">
              {counts.ready} ready · {counts.draft} drafts · {counts.active} active
            </div>
          </div>
        </div>

        <div className="toolbar">
          <Tabs
            items={tabItems}
            value={tab}
            onChange={(v) => setTab(v as TabValue)}
          />
          <div className="spacer" />
          <input
            className="input-search"
            type="search"
            placeholder="Search title or brand…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="toolbar">
          <Check checked={allSelected} onChange={toggleAll} />
          <span className="toolbar__count">
            {selectionCount > 0
              ? `${selectionCount} selected`
              : `${filtered.length} of ${total}`}
          </span>
          <div className="toolbar__divider" />
          {selectionCount > 0 ? (
            <div className="toolbar__group">
              <Btn
                variant="secondary"
                icon="send"
                onClick={() => setPublishItem(firstSelected)}
                disabled={!firstSelected}
              >
                Publish…
              </Btn>
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
      </main>

      <PublishModal
        open={publishItem !== null}
        onClose={() => setPublishItem(null)}
        item={publishItem}
        onPublished={reload}
      />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={reload}
      />
    </>
  );
}
