"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";

type Confidence = "none" | "low" | "medium" | "high";

type PricingSummary = {
  status: "needs_comps" | "ready";
  totalComps: number;
  validComps: number;
  lowCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: Confidence;
};

type PriceComp = {
  id: string;
  source: string;
  title: string;
  priceCents: number;
  shippingCents: number;
  soldDate: string | null;
  url: string | null;
  condition: string;
  notes: string | null;
};

type CompsResponse = {
  comps: PriceComp[];
  summary: PricingSummary;
};

const conditionOptions = [
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
] as const;

const emptyForm = {
  source: "",
  title: "",
  price: "",
  shipping: "",
  soldDate: "",
  url: "",
  condition: "unknown",
  notes: "",
};

function formatCents(cents: number | null) {
  if (cents == null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function dollarsToCents(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function nonNegativeCents(value: string) {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

const confidenceStyles: Record<Confidence, string> = {
  none: "border-neutral-300 bg-neutral-100 text-neutral-600",
  low: "border-amber-300 bg-amber-50 text-amber-900",
  medium: "border-sky-300 bg-sky-50 text-sky-900",
  high: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

export default function CompsPanel({
  accessToken,
  inventoryItemId,
}: {
  accessToken: string;
  inventoryItemId: string;
}) {
  const [comps, setComps] = useState<PriceComp[]>([]);
  const [summary, setSummary] = useState<PricingSummary | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load comps.");
        }

        setComps(payload.comps);
        setSummary(payload.summary);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load comps.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadComps();

    return () => {
      cancelled = true;
    };
  }, [accessToken, inventoryItemId]);

  async function addComp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const priceCents = dollarsToCents(form.price);
    if (priceCents == null) {
      setError("Enter a comp sale price greater than $0.");
      return;
    }

    const shippingCents = nonNegativeCents(form.shipping);
    if (shippingCents == null) {
      setError("Shipping must be $0 or more.");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const response = await fetch("/api/listings/comps", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inventoryItemId,
          comp: {
            source: form.source,
            title: form.title,
            priceCents,
            shippingCents,
            soldDate: form.soldDate ? form.soldDate : null,
            url: form.url ? form.url : null,
            condition: form.condition,
            notes: form.notes ? form.notes : null,
          },
        }),
      });
      const payload = (await response.json()) as CompsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not add the comp.");
      }

      setComps(payload.comps);
      setSummary(payload.summary);
      setForm(emptyForm);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not add the comp.");
    } finally {
      setIsSaving(false);
    }
  }

  const needsComps = !summary || summary.status === "needs_comps";

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-neutral-300 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Comp-based pricing
          </h3>
          {summary ? (
            <span
              className={`border px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${confidenceStyles[summary.confidence]}`}
            >
              {summary.confidence === "none" ? "Needs comps" : `${summary.confidence} confidence`}
            </span>
          ) : null}
        </div>

        {needsComps ? (
          <p className="mt-3 text-sm text-neutral-600">
            Needs comps. Add real sold comps below. Pricing is never invented without comps.
          </p>
        ) : (
          <dl className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Low", summary!.lowCents],
              ["Average", summary!.averageCents],
              ["High", summary!.highCents],
              ["Quick sale", summary!.quickSaleCents],
              ["Recommended", summary!.recommendedListCents],
            ].map(([label, value]) => (
              <div key={label as string} className="border border-neutral-200 p-3">
                <dt className="text-xs uppercase tracking-[0.12em] text-neutral-500">{label}</dt>
                <dd className="mt-1 text-base font-semibold">{formatCents(value as number | null)}</dd>
              </div>
            ))}
          </dl>
        )}
        {summary && summary.validComps > 0 ? (
          <p className="mt-2 text-xs text-neutral-500">
            Based on {summary.validComps} valid comp{summary.validComps === 1 ? "" : "s"} of{" "}
            {summary.totalComps}. You can override the final price in the editor.
          </p>
        ) : null}
      </div>

      <form onSubmit={addComp} className="border border-neutral-300 bg-white p-4">
        <p className="text-sm font-semibold">Add a manual comp</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Source</span>
            <input
              required
              value={form.source}
              onChange={(event) => setForm((f) => ({ ...f, source: event.target.value }))}
              placeholder="eBay sold, StockX, Grailed sold"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <input
              required
              value={form.title}
              onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
              placeholder="Comparable item title"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Sale price (USD)</span>
            <input
              required
              inputMode="decimal"
              value={form.price}
              onChange={(event) => setForm((f) => ({ ...f, price: event.target.value }))}
              placeholder="225.00"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Shipping (USD)</span>
            <input
              inputMode="decimal"
              value={form.shipping}
              onChange={(event) => setForm((f) => ({ ...f, shipping: event.target.value }))}
              placeholder="0.00"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Sold date</span>
            <input
              type="date"
              value={form.soldDate}
              onChange={(event) => setForm((f) => ({ ...f, soldDate: event.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Condition</span>
            <select
              value={form.condition}
              onChange={(event) => setForm((f) => ({ ...f, condition: event.target.value }))}
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
              onChange={(event) => setForm((f) => ({ ...f, url: event.target.value }))}
              placeholder="https://"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
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
          Add comp
        </button>
        {error ? (
          <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </form>

      <div className="border border-neutral-300 bg-white">
        <div className="border-b border-neutral-200 p-4">
          <p className="text-sm font-semibold">Comps ({comps.length})</p>
        </div>
        {isLoading ? (
          <p className="p-4 text-sm text-neutral-500">Loading comps…</p>
        ) : comps.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">No comps yet. Needs comps.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-[0.12em] text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Ship</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Sold</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((comp) => (
                  <tr key={comp.id} className="border-b border-neutral-100">
                    <td className="px-4 py-3">{comp.source}</td>
                    <td className="px-4 py-3">
                      {comp.url && isHttpUrl(comp.url) ? (
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-700 underline"
                        >
                          {comp.title}
                        </a>
                      ) : (
                        comp.title
                      )}
                    </td>
                    <td className="px-4 py-3">{formatCents(comp.priceCents)}</td>
                    <td className="px-4 py-3">{formatCents(comp.shippingCents)}</td>
                    <td className="px-4 py-3 font-medium">
                      {formatCents(comp.priceCents + comp.shippingCents)}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {comp.soldDate ? new Date(comp.soldDate).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
