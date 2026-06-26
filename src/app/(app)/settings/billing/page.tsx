"use client";

import { useEffect, useState } from "react";

import { useSession } from "@/components/providers/session-provider";
import { UsageMeter } from "@/components/billing/usage-meter";
import { Btn } from "@/components/ui/primitives";
import { readJsonResponse } from "@/lib/http";
import { PLAN_CATALOG, type PlanId } from "@/lib/billing/plans";

interface UsageSnapshot {
  plan: PlanId;
  limits: {
    aiListingsPerMonth: number;
    autopublishesPerMonth: number;
    compRefreshesPerMonth: number;
  };
  usage: { ai_listing: number; autopublish: number; comp_refresh: number };
  periodEnd: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function BillingSettingsPage() {
  const { token } = useSession();
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const payload = await readJsonResponse<UsageSnapshot>(
          await fetch("/api/billing/usage", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        if (active) {
          setData(payload);
          setError(null);
        }
      } catch (e) {
        if (active) {
          setError((e as { error?: string })?.error ?? "Failed to load billing.");
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  async function postFor(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const { url } = await readJsonResponse<{ url: string }>(res);
      window.location.href = url;
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Billing</h1>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {!data && !error ? (
        <p className="mt-6 text-sm text-neutral-500">Loading…</p>
      ) : null}

      {data ? (
        <div className="mt-6 space-y-8">
          <section className="rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-500">Current plan</p>
                <p className="text-xl font-semibold text-neutral-900">
                  {PLAN_CATALOG[data.plan].name}
                </p>
              </div>
              <div className="text-right text-sm text-neutral-500">
                <p>Status: {data.status}</p>
                <p>
                  {data.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatDate(data.periodEnd)}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-neutral-700">This period</h2>
            <UsageMeter
              label="AI listings"
              used={data.usage.ai_listing}
              limit={data.limits.aiListingsPerMonth}
            />
            <UsageMeter
              label="Autopublishes"
              used={data.usage.autopublish}
              limit={data.limits.autopublishesPerMonth}
            />
            <UsageMeter
              label="Comp refreshes"
              used={data.usage.comp_refresh}
              limit={data.limits.compRefreshesPerMonth}
            />
          </section>

          <section className="flex flex-wrap gap-3">
            {data.plan === "free" ? (
              <>
                <Btn variant="primary" disabled={busy} onClick={() => postFor("/api/billing/checkout", { plan: "pro" })}>
                  Upgrade to Pro
                </Btn>
                <Btn variant="secondary" disabled={busy} onClick={() => postFor("/api/billing/checkout", { plan: "kingpin" })}>
                  Upgrade to Kingpin
                </Btn>
              </>
            ) : (
              <Btn variant="primary" disabled={busy} onClick={() => postFor("/api/billing/portal")}>
                Manage billing
              </Btn>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
