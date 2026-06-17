"use client";

import { useEffect, useState } from "react";

import { Banner, Btn } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session-provider";
import { api, type PriceCompRow } from "@/lib/api/client";
import { getAutoCompStatusCopy } from "@/lib/comps/status";
import { formatMoneyCents, relativeTime } from "@/lib/view/format";

type Summary = {
  status: string;
  totalComps: number;
  validComps: number;
  soldCompCount?: number;
  activeCompCount?: number;
  unknownCompCount?: number;
  strongCompCount?: number;
  possibleCompCount?: number;
  pricingBasis?: string;
  confidenceCapReason?: string | null;
  lowCents: number | null;
  medianCents?: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: string;
  confidenceScore?: number;
  confidenceReasons?: string[];
};

type Discovery = {
  status: string;
  autoDiscoveryEnabled: boolean;
  enabledSources: string[];
  queries: string[];
  sourceErrors: { source: string; message: string }[];
  lastRunAt: string | null;
  acceptedCount?: number | null;
  rejectedCount?: number | null;
  cooldownSecondsRemaining?: number;
};

type ManualCompForm = {
  source: string;
  title: string;
  price: string;
  url: string;
};

const emptyManualComp: ManualCompForm = {
  source: "Manual sold comp",
  title: "",
  price: "",
  url: "",
};

function rawMetadata(comp: PriceCompRow): { matchClassification?: string; matchReasons?: string[] } {
  if (!comp.rawJson || typeof comp.rawJson !== "object" || Array.isArray(comp.rawJson)) return {};
  const raw = comp.rawJson as Record<string, unknown>;
  return {
    matchClassification:
      typeof raw.matchClassification === "string" ? raw.matchClassification : undefined,
    matchReasons: Array.isArray(raw.matchReasons)
      ? raw.matchReasons.filter((reason): reason is string => typeof reason === "string")
      : undefined,
  };
}

function centsFromDollars(value: string): number | null {
  const normalized = value.trim().replace(/^\$/, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function basisLabel(summary: Summary): string {
  if (summary.pricingBasis === "sold_comps") return "sold-comp pricing";
  if (summary.pricingBasis === "mixed_comps") return "mixed sold + market estimate";
  if (summary.pricingBasis === "active_market_estimate") return "market listing estimate";
  return "pricing estimate";
}

function sampleLabel(summary: Summary): string {
  if (summary.soldCompCount && summary.soldCompCount > 0 && (summary.activeCompCount ?? 0) === 0) {
    return `${summary.validComps} sold comp${summary.validComps === 1 ? "" : "s"}`;
  }
  if (summary.pricingBasis === "active_market_estimate" || (summary.soldCompCount ?? 0) === 0) {
    return `${summary.validComps} market listing${summary.validComps === 1 ? "" : "s"}`;
  }
  return `${summary.soldCompCount ?? 0} sold · ${summary.activeCompCount ?? 0} market`;
}

function compKindLabel(comp: PriceCompRow): string {
  if (comp.sourceType === "manual" && comp.status === "sold") return "manual sold comp";
  if (comp.status === "sold") return "sold/completed comp";
  if (comp.status === "active") return "active market listing";
  return "status unknown";
}

// Read-only automatic pricing. Comps are gathered for the seller, not entered by
// hand. Pricing is computed from real comps only; nothing is invented. A
// "Refresh comps" action runs the configured comp sources on demand.
export function AutoPricing({
  itemId,
  onApplyPrice,
}: {
  itemId: string;
  onApplyPrice?: (priceCents: number) => void;
}) {
  const { token } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [comps, setComps] = useState<PriceCompRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualComp, setManualComp] = useState<ManualCompForm>(emptyManualComp);
  const [savingManual, setSavingManual] = useState(false);
  const [busyCompId, setBusyCompId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await api.getComps(token, itemId);
        if (active) {
          setSummary(res.summary);
          setDiscovery(res.discovery);
          setComps(res.comps);
          setError(null);
        }
      } catch (e) {
        if (active) setError((e as { error?: string })?.error ?? "Could not load pricing.");
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, itemId, reloadKey]);

  async function refresh() {
    setRefreshing(true);
    setNote(null);
    try {
      const res = await api.refreshComps(token, itemId);
      setReloadKey((k) => k + 1);
      if (res.appliedPriceCents != null) onApplyPrice?.(res.appliedPriceCents);
      setNote(
        res.enabled === 0
          ? "No automatic comp source is connected. Manual comps still work."
          : `Checked ${res.sources.join(", ")} · ${res.accepted} accepted · ${res.rejected} filtered. Active listings remain market estimates until sold data is available.`,
      );
    } catch (e) {
      setNote((e as { error?: string })?.error ?? "Could not refresh comps.");
    } finally {
      setRefreshing(false);
    }
  }

  async function addManualComp() {
    const priceCents = centsFromDollars(manualComp.price);
    if (priceCents == null || manualComp.title.trim().length === 0) {
      setNote("Add a manual comp title and a price above $0.");
      return;
    }

    setSavingManual(true);
    setNote(null);
    try {
      const res = await api.addComp(token, {
        inventoryItemId: itemId,
        comp: {
          source: manualComp.source.trim() || "Manual sold comp",
          sourceType: "manual",
          platform: null,
          status: "sold",
          title: manualComp.title.trim(),
          priceCents,
          shippingCents: 0,
          currency: "USD",
          url: manualComp.url.trim() || null,
          condition: "unknown",
          usedInPricing: true,
          ignoredAsOutlier: false,
          notes: "Manual sold comp added from listing editor.",
        },
      });
      setSummary(res.summary);
      setComps(res.comps);
      setManualComp(emptyManualComp);
      setManualOpen(false);
      setNote("Manual comp added.");
    } catch (e) {
      setNote((e as { error?: string })?.error ?? "Could not add manual comp.");
    } finally {
      setSavingManual(false);
    }
  }

  async function rejectComp(comp: PriceCompRow) {
    setBusyCompId(comp.id);
    setNote(null);
    try {
      const res = await api.updateComp(token, comp.id, {
        usedInPricing: false,
        ignoredAsOutlier: true,
        notes: comp.notes
          ? `${comp.notes} Rejected in pricing review.`
          : "Rejected in pricing review.",
      });
      setSummary(res.summary);
      setComps(res.comps);
      setNote("Comp rejected and removed from automatic pricing.");
    } catch (e) {
      setNote((e as { error?: string })?.error ?? "Could not reject comp.");
    } finally {
      setBusyCompId(null);
    }
  }

  async function includeComp(comp: PriceCompRow) {
    setBusyCompId(comp.id);
    setNote(null);
    try {
      const res = await api.updateComp(token, comp.id, {
        usedInPricing: true,
        ignoredAsOutlier: false,
        notes: comp.notes
          ? `${comp.notes} Re-included in pricing review.`
          : "Re-included in pricing review.",
      });
      setSummary(res.summary);
      setComps(res.comps);
      setNote("Comp re-included in automatic pricing.");
    } catch (e) {
      setNote((e as { error?: string })?.error ?? "Could not include comp.");
    } finally {
      setBusyCompId(null);
    }
  }

  async function deleteComp(comp: PriceCompRow) {
    setBusyCompId(comp.id);
    setNote(null);
    try {
      const res = await api.deleteComp(token, comp.id);
      setSummary(res.summary);
      setComps(res.comps);
      setNote("Comp deleted.");
    } catch (e) {
      setNote((e as { error?: string })?.error ?? "Could not delete comp.");
    } finally {
      setBusyCompId(null);
    }
  }

  const cooldownRemaining = discovery?.cooldownSecondsRemaining ?? 0;
  const refreshDisabled = refreshing || cooldownRemaining > 0;
  const refreshBtn = (
    <Btn
      variant="secondary"
      size="sm"
      icon="refresh"
      onClick={refresh}
      disabled={refreshDisabled}
    >
      {refreshing
        ? "Fetching…"
        : cooldownRemaining > 0
          ? `Refresh in ${cooldownRemaining}s`
          : "Refresh comps"}
    </Btn>
  );

  if (error) return <div className="t-small danger">{error}</div>;
  if (!summary || !discovery) return <div className="t-small muted">Loading pricing…</div>;

  const hasData = summary.validComps > 0 && summary.recommendedListCents != null;
  const copy = getAutoCompStatusCopy(discovery, summary);
  const queryList = discovery.queries.slice(0, 4);
  const sourceList = discovery.enabledSources.length > 0 ? discovery.enabledSources.join(", ") : "None";
  const canAccept =
    summary.recommendedListCents != null &&
    (summary.confidence === "medium" || summary.confidence === "low") &&
    onApplyPrice;
  const visibleComps = comps.slice(0, 8);
  const basis = basisLabel(summary);
  const soldCount = summary.soldCompCount ?? 0;
  const activeCount = summary.activeCompCount ?? 0;
  const paidProvidersEnabled = discovery.enabledSources.some((source) =>
    source.toLowerCase().includes("apify"),
  );

  const details = (
    <div className="stack-2">
      <div>Basis: {basis}</div>
      <div>
        Evidence: {soldCount} sold/completed · {activeCount} active market
        {summary.unknownCompCount ? ` · ${summary.unknownCompCount} unknown` : ""}
      </div>
      {summary.strongCompCount != null && (
        <div>
          Match quality: {summary.strongCompCount} strong · {summary.possibleCompCount ?? 0} possible
        </div>
      )}
      <div>Sources: {sourceList}</div>
      {discovery.lastRunAt && (
        <div>
          Last auto run: {relativeTime(discovery.lastRunAt)}
          {cooldownRemaining > 0 ? ` · refresh cooldown ${cooldownRemaining}s` : ""}
        </div>
      )}
      {queryList.length > 0 && (
        <div>
          Queries: {queryList.join(" · ")}
        </div>
      )}
      {paidProvidersEnabled && (
        <div>
          Refresh comps may run a paid provider. Confirm item details before refreshing.
        </div>
      )}
      {discovery.sourceErrors.length > 0 && (
        <div>
          Source errors:{" "}
          {discovery.sourceErrors.map((err) => `${err.source}: ${err.message}`).join(" · ")}
        </div>
      )}
      {note && <div>{note}</div>}
    </div>
  );

  const manualCompControls = (
    <div className="stack-2">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="t-small muted">Manual sold-comp fallback</span>
        <Btn
          variant="ghost"
          size="sm"
          icon={manualOpen ? "x" : "plus"}
          onClick={() => setManualOpen((open) => !open)}
        >
          {manualOpen ? "Close" : "Add sold comp"}
        </Btn>
      </div>
      {manualOpen && (
        <div className="stack-2">
          <div className="form-grid form-grid--2" style={{ gap: 10 }}>
            <label className="field">
              <span>Source</span>
              <input
                value={manualComp.source}
                onChange={(e) => setManualComp((form) => ({ ...form, source: e.target.value }))}
                placeholder="eBay sold, Grailed sold"
              />
            </label>
            <label className="field">
              <span>Sold/completed price</span>
              <input
                value={manualComp.price}
                onChange={(e) => setManualComp((form) => ({ ...form, price: e.target.value }))}
                placeholder="165.00"
                inputMode="decimal"
              />
            </label>
          </div>
          <label className="field">
            <span>Title</span>
            <input
              value={manualComp.title}
              onChange={(e) => setManualComp((form) => ({ ...form, title: e.target.value }))}
              placeholder="Comparable item title"
            />
          </label>
          <label className="field">
            <span>URL</span>
            <input
              value={manualComp.url}
              onChange={(e) => setManualComp((form) => ({ ...form, url: e.target.value }))}
              placeholder="https://"
              type="url"
            />
          </label>
          <Btn variant="secondary" size="sm" onClick={addManualComp} disabled={savingManual}>
            {savingManual ? "Adding…" : "Add sold comp"}
          </Btn>
        </div>
      )}
    </div>
  );

  const compList = visibleComps.length > 0 && (
    <div className="stack-2">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="t-small muted">Candidate price signals</span>
        <span className="t-micro">
          {summary.validComps} used · {Math.max(0, summary.totalComps - summary.validComps)} filtered
        </span>
      </div>
      <div className="stack-2">
        {visibleComps.map((comp) => {
          const raw = rawMetadata(comp);
          const total = comp.totalPriceCents ?? comp.priceCents + comp.shippingCents;
          const classification =
            raw.matchClassification ?? (comp.usedInPricing ? "possible" : "rejected");
          const reasons = raw.matchReasons?.slice(0, 2) ?? [];
          return (
            <div key={comp.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
                <div className="stack-1" style={{ minWidth: 0 }}>
                  <div className="t-small" style={{ fontWeight: 650 }}>
                    {comp.title}
                  </div>
                  <div className="t-micro">
                    {comp.source.replace(/^auto:/, "")} · {compKindLabel(comp)} · {classification}
                    {comp.matchScore != null ? ` · ${Math.round(comp.matchScore * 100)}%` : ""}
                    {comp.soldDate
                      ? ` · sold ${new Date(comp.soldDate).toLocaleDateString()}`
                      : ""}
                    {` · ${
                      comp.usedInPricing
                        ? "used in pricing"
                        : comp.ignoredAsOutlier
                          ? "excluded (outlier)"
                          : "excluded"
                    }`}
                  </div>
                  {reasons.length > 0 && <div className="t-small muted">{reasons.join(" · ")}</div>}
                </div>
                <div className="stack-1" style={{ alignItems: "end" }}>
                  <div className="t-num">{formatMoneyCents(total)}</div>
                  <div className="t-micro muted">
                    {formatMoneyCents(comp.priceCents)} + {formatMoneyCents(comp.shippingCents)} ship
                  </div>
                  {comp.url && (
                    <a className="t-micro" href={comp.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  )}
                  <div className="row" style={{ gap: 6 }}>
                    {comp.usedInPricing ? (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => rejectComp(comp)}
                        disabled={busyCompId === comp.id}
                      >
                        {busyCompId === comp.id ? "…" : "Exclude"}
                      </Btn>
                    ) : (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => includeComp(comp)}
                        disabled={busyCompId === comp.id}
                      >
                        {busyCompId === comp.id ? "…" : "Include"}
                      </Btn>
                    )}
                    {comp.sourceType === "manual" && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteComp(comp)}
                        disabled={busyCompId === comp.id}
                      >
                        Delete
                      </Btn>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!hasData) {
    return (
      <div className="stack-3">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="t-micro">Automatic pricing</span>
          {refreshBtn}
        </div>
        <Banner
          variant={copy.variant}
          icon="spark"
          title={copy.title}
          desc={details}
        />
        {manualCompControls}
        {compList}
      </div>
    );
  }

  const stats: { label: string; value: string }[] = [
    { label: summary.pricingBasis === "active_market_estimate" ? "Market low" : "Lowest", value: formatMoneyCents(summary.lowCents) },
    { label: summary.pricingBasis === "active_market_estimate" ? "Market median" : "Median", value: formatMoneyCents(summary.medianCents ?? null) },
    { label: summary.pricingBasis === "active_market_estimate" ? "Market average" : "Average", value: formatMoneyCents(summary.averageCents) },
    { label: summary.pricingBasis === "active_market_estimate" ? "Market high" : "Highest", value: formatMoneyCents(summary.highCents) },
    { label: "Quick sale", value: formatMoneyCents(summary.quickSaleCents) },
    { label: summary.pricingBasis === "active_market_estimate" ? "Suggested list" : "Recommended", value: formatMoneyCents(summary.recommendedListCents) },
  ];

  return (
    <div className="stack-3">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="t-small muted">
          From {sampleLabel(summary)}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge badge--ready" style={{ textTransform: "capitalize" }}>
            {summary.confidence} confidence
          </span>
          {refreshBtn}
        </div>
      </div>
      <div className="form-grid form-grid--3" style={{ gap: 12 }}>
        {stats.map((s) => (
          <div key={s.label} className="card" style={{ padding: 12 }}>
            <div className="t-micro">{s.label}</div>
            <div className="t-num" style={{ fontFamily: "var(--font-serif)", fontSize: 22 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <Banner
        variant={copy.variant}
        title={copy.title}
        desc={details}
        actions={
          canAccept ? (
            <Btn
              variant="secondary"
              size="sm"
              onClick={() => onApplyPrice?.(summary.recommendedListCents as number)}
            >
              Accept recommendation
            </Btn>
          ) : undefined
        }
      />
      {summary.confidenceReasons && summary.confidenceReasons.length > 0 && (
        <ul className="stack-1 t-small muted" style={{ paddingLeft: 18 }}>
          {summary.confidenceCapReason && <li>{summary.confidenceCapReason}</li>}
          {summary.confidenceReasons
            .filter((reason) => reason !== summary.confidenceCapReason)
            .map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {manualCompControls}
      {compList}
    </div>
  );
}
