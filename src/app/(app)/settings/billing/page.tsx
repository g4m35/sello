"use client";

import { useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/providers/session-provider";
import { UsageMeter } from "@/components/billing/usage-meter";
import { Banner, Btn } from "@/components/ui/primitives";
import { Topbar } from "@/components/app/topbar";
import { readJsonResponse } from "@/lib/http";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import {
  fetchBillingUsage,
  getCachedBillingUsage,
  type UsageSnapshot,
} from "@/components/billing/usage-snapshot";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function BillingSettingsPage() {
  const { token } = useSession();
  const checkoutStatus = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("status");
  }, []);
  const [data, setData] = useState<UsageSnapshot | null>(() =>
    getCachedBillingUsage(token),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const forceRefresh = checkoutStatus === "success";

    async function load() {
      try {
        const payload = await fetchBillingUsage(token, { force: forceRefresh });
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
  }, [checkoutStatus, token]);

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
    <>
      <Topbar crumbs={["Settings", "Billing"]} />

      <main className="page">
        <div className="page__head">
          <div className="page__title-row">
            <h1 className="page__title">
              Billing<em>.</em>
            </h1>
            <div className="page__title-meta">Plan, usage, and subscription controls</div>
          </div>
        </div>

        <div className="stack-4" style={{ display: "grid", gap: 20, maxWidth: 920 }}>
          {error ? <Banner variant="error" title="Billing unavailable" desc={error} /> : null}
          {checkoutStatus === "success" ? (
            <Banner
              variant="info"
              title="Checkout complete"
              desc="Your billing details are refreshing from Stripe."
            />
          ) : null}
          {checkoutStatus === "cancelled" ? (
            <Banner
              variant="info"
              title="Checkout cancelled"
              desc="No plan changes were made."
            />
          ) : null}

          {!data && !error ? <BillingSkeleton /> : null}

          {data ? (
            <>
              <section className="card">
                <div className="card__head">
                  <span className="card__title">Current plan</span>
                  <span className="badge badge--ready">
                    <span className="badge__dot" />
                    {data.status}
                  </span>
                </div>
                <div className="card__body">
                  <div
                    className="row"
                    style={{
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div className="t-micro">Plan</div>
                      <div className="t-h1" style={{ marginTop: 6 }}>
                        {PLAN_CATALOG[data.plan].name}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="t-micro">{data.cancelAtPeriodEnd ? "Ends" : "Renews"}</div>
                      <div className="t-body" style={{ marginTop: 6 }}>
                        {formatDate(data.periodEnd)}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card__head">
                  <span className="card__title">This period</span>
                </div>
                <div className="card__body">
                  <div style={{ display: "grid", gap: 18 }}>
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
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card__body">
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    {data.plan === "free" ? (
                      <>
                        <Btn
                          variant="primary"
                          disabled={busy}
                          onClick={() => postFor("/api/billing/checkout", { plan: "pro" })}
                        >
                          Upgrade to Pro
                        </Btn>
                        <Btn
                          variant="secondary"
                          disabled={busy}
                          onClick={() => postFor("/api/billing/checkout", { plan: "kingpin" })}
                        >
                          Upgrade to Kingpin
                        </Btn>
                      </>
                    ) : (
                      <Btn
                        variant="primary"
                        disabled={busy}
                        onClick={() => postFor("/api/billing/portal")}
                      >
                        Manage billing
                      </Btn>
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}

function BillingSkeleton() {
  return (
    <>
      <section className="card">
        <div className="card__head">
          <div className="skel" style={{ width: 112, height: 14 }} />
          <div className="skel" style={{ width: 78, height: 22, borderRadius: 999 }} />
        </div>
        <div className="card__body">
          <div className="row" style={{ justifyContent: "space-between", gap: 16 }}>
            <div>
              <div className="skel" style={{ width: 42, height: 10, marginBottom: 10 }} />
              <div className="skel" style={{ width: 132, height: 34 }} />
            </div>
            <div>
              <div className="skel" style={{ width: 52, height: 10, marginBottom: 10 }} />
              <div className="skel" style={{ width: 126, height: 18 }} />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div className="skel" style={{ width: 94, height: 14 }} />
        </div>
        <div className="card__body">
          <div style={{ display: "grid", gap: 18 }}>
            {[0, 1, 2].map((item) => (
              <div key={item} className="usage-meter">
                <div className="usage-meter__head">
                  <div className="skel" style={{ width: 110, height: 12 }} />
                  <div className="skel" style={{ width: 42, height: 12 }} />
                </div>
                <div className="skel" style={{ height: 6, borderRadius: 999 }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
