"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";

import {
  CompsTable,
  PricingRecommendationCard,
  type CompRow,
  type CompStatus,
  type Summary,
} from "./comps-pricing-view";

type CompsResponse = { comps: CompRow[]; summary: Summary };

const conditionOptions = [
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
] as const;

const platformOptions = [
  "",
  "ebay",
  "stockx",
  "grailed",
  "poshmark",
  "depop",
  "goat",
  "other",
] as const;

const statusOptions: CompStatus[] = ["sold", "active", "unknown"];

const emptyForm = {
  source: "",
  platform: "",
  status: "sold" as CompStatus,
  title: "",
  brand: "",
  size: "",
  price: "",
  shipping: "",
  soldDate: "",
  url: "",
  condition: "unknown",
  notes: "",
};

type FormState = typeof emptyForm;

function dollarsToCents(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function nonNegativeCents(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

export default function CompsPanel({
  accessToken,
  inventoryItemId,
}: {
  accessToken: string;
  inventoryItemId: string;
}) {
  const [comps, setComps] = useState<CompRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadComps() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/listings/comps?inventoryItemId=${encodeURIComponent(inventoryItemId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as CompsResponse & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? "Could not load comps.");
        setComps(payload.comps);
        setSummary(payload.summary);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load comps.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadComps();
    return () => {
      cancelled = true;
    };
  }, [accessToken, inventoryItemId]);

  function applyResponse(payload: CompsResponse) {
    setComps(payload.comps);
    setSummary(payload.summary);
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const priceCents = dollarsToCents(form.price);
    if (priceCents == null) {
      setError("Enter a comp price greater than $0.");
      return;
    }
    const shippingCents = nonNegativeCents(form.shipping);
    if (shippingCents == null) {
      setError("Shipping must be $0 or more.");
      return;
    }

    setIsSaving(true);
    setError("");

    const compBody = {
      source: form.source,
      platform: form.platform ? form.platform : null,
      status: form.status,
      title: form.title,
      brand: form.brand ? form.brand : null,
      size: form.size ? form.size : null,
      priceCents,
      shippingCents,
      soldDate: form.soldDate ? form.soldDate : null,
      url: form.url ? form.url : null,
      condition: form.condition,
      notes: form.notes ? form.notes : null,
    };

    try {
      const response = editingId
        ? await fetch(`/api/listings/comps/${editingId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(compBody),
          })
        : await fetch("/api/listings/comps", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ inventoryItemId, comp: compBody }),
          });

      const payload = (await response.json()) as CompsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save the comp.");
      applyResponse(payload);
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the comp.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(comp: CompRow) {
    setEditingId(comp.id);
    setError("");
    setForm({
      source: comp.source,
      platform: comp.platform ?? "",
      status: comp.status,
      title: comp.title,
      brand: comp.brand ?? "",
      size: comp.size ?? "",
      price: (comp.priceCents / 100).toString(),
      shipping: comp.shippingCents ? (comp.shippingCents / 100).toString() : "",
      soldDate: comp.soldDate ? comp.soldDate.slice(0, 10) : "",
      url: comp.url ?? "",
      condition: comp.condition,
      notes: comp.notes ?? "",
    });
  }

  async function toggleField(comp: CompRow, field: "usedInPricing" | "ignoredAsOutlier") {
    setBusyId(comp.id);
    setError("");
    try {
      const response = await fetch(`/api/listings/comps/${comp.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [field]: !comp[field] }),
      });
      const payload = (await response.json()) as CompsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update the comp.");
      applyResponse(payload);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not update the comp.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteComp(comp: CompRow) {
    setBusyId(comp.id);
    setError("");
    try {
      const response = await fetch(`/api/listings/comps/${comp.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json()) as CompsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not delete the comp.");
      applyResponse(payload);
      if (editingId === comp.id) resetForm();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the comp.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {summary ? <PricingRecommendationCard summary={summary} /> : null}

      <form onSubmit={submitForm} className="border border-neutral-300 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{editingId ? "Edit comp" : "Add a manual comp"}</p>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
            >
              <X className="h-3 w-3" /> Cancel edit
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Source</span>
            <input
              required
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              placeholder="eBay sold, StockX, Grailed sold"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Platform</span>
            <select
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            >
              {platformOptions.map((option) => (
                <option key={option || "none"} value={option}>
                  {option ? option : "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CompStatus }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Comparable item title"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Brand</span>
            <input
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              placeholder="Nike"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Size</span>
            <input
              value={form.size}
              onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
              placeholder="10.5"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Sale price (USD)</span>
            <input
              required
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              placeholder="225.00"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Shipping (USD)</span>
            <input
              inputMode="decimal"
              value={form.shipping}
              onChange={(e) => setForm((f) => ({ ...f, shipping: e.target.value }))}
              placeholder="0.00"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Sold date</span>
            <input
              type="date"
              value={form.soldDate}
              onChange={(e) => setForm((f) => ({ ...f, soldDate: e.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Condition</span>
            <select
              value={form.condition}
              onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            >
              {conditionOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Listing URL</span>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Why this comp is comparable (size, condition, recency)."
              className="resize-y border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="mt-3 inline-flex h-10 items-center justify-center gap-2 bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {editingId ? "Save changes" : "Add comp"}
        </button>
        {error ? (
          <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </form>

      {isLoading ? (
        <p className="border border-neutral-300 bg-white p-4 text-sm text-neutral-500">
          Loading comps…
        </p>
      ) : (
        <CompsTable
          comps={comps}
          onEdit={startEdit}
          onDelete={deleteComp}
          onToggle={toggleField}
          busyId={busyId}
        />
      )}
    </div>
  );
}
