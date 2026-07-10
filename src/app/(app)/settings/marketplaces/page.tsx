"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
  XCircle,
} from "lucide-react";

import { getErrorMessage } from "@/lib/errors";
import { readJsonResponse } from "@/lib/http";
import {
  consumeSupabaseImplicitSessionFromUrl,
  getBrowserSupabase,
} from "@/lib/supabase/browser";
import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";
import { Topbar } from "@/components/app/topbar";

import { ebayMarketplaceLabels } from "./labels";
import { EtsyConnectionCard } from "./etsy-card";
import { StockXConnectionCard } from "./stockx-card";
import {
  ebayReadinessHelp,
  ebayReadinessItems,
  ebayReadinessLabels,
  getEbayActionModel,
  getEbaySetupMessage,
  shouldAutoRefreshEbayReadiness,
  shouldOfferEbayLocationSetup,
  type EbayReadinessItem,
} from "./view-model";

type LoadState = "idle" | "loading" | "ready" | "error";

type LocationForm = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  phone: string;
};

const emptyLocationForm: LocationForm = {
  name: "Default location",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateOrProvince: "",
  postalCode: "",
  phone: "",
};

export default function MarketplaceSettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [readiness, setReadiness] = useState<EbayReadinessResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [actionState, setActionState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState<LocationForm>(emptyLocationForm);
  const autoRefreshAttemptedRef = useRef(false);
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session?.access_token]);

  const loadReadiness = useCallback(async () => {
    if (!session?.access_token) return;

    setLoadState("loading");
    setError(null);
    try {
      const payload = await readJsonResponse<EbayReadinessResponse>(
        await fetch("/api/marketplaces/ebay/readiness", {
          headers: authHeaders(),
        }),
      );
      setReadiness(payload);
      setLoadState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setLoadState("error");
    }
  }, [authHeaders, session?.access_token]);

  const connectEbay = useCallback(async () => {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      const payload = await readJsonResponse<{ authorizationUrl: string }>(
        await fetch("/api/marketplaces/ebay/connect", {
          headers: {
            ...authHeaders(),
            Accept: "application/json",
          },
        }),
      );
      window.location.assign(payload.authorizationUrl);
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }, [authHeaders, session?.access_token, supabase]);

  const refreshReadiness = useCallback(async () => {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      const payload = await readJsonResponse<EbayReadinessResponse>(
        await fetch("/api/marketplaces/ebay/readiness", {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      setReadiness(payload);
      setActionState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }, [authHeaders, session?.access_token, supabase]);

  const createInventoryLocation = useCallback(async () => {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      await readJsonResponse<{ ok: true }>(
        await fetch("/api/marketplaces/ebay/locations", {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: locationForm.name,
            addressLine1: locationForm.addressLine1,
            ...(locationForm.addressLine2.trim()
              ? { addressLine2: locationForm.addressLine2 }
              : {}),
            city: locationForm.city,
            stateOrProvince: locationForm.stateOrProvince,
            postalCode: locationForm.postalCode,
            country: "US",
            ...(locationForm.phone.trim() ? { phone: locationForm.phone } : {}),
          }),
        }),
      );
      // Creation succeeded: re-check readiness so the tile flips to Ready.
      const payload = await readJsonResponse<EbayReadinessResponse>(
        await fetch("/api/marketplaces/ebay/readiness", {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      setReadiness(payload);
      setActionState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }, [authHeaders, locationForm, session?.access_token, supabase]);

  const disconnectEbay = useCallback(async () => {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      await readJsonResponse<{ ok: true }>(
        await fetch("/api/marketplaces/ebay/disconnect", {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      await loadReadiness();
      setActionState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }, [authHeaders, loadReadiness, session?.access_token, supabase]);

  useEffect(() => {
    let mounted = true;

    if (!supabase) {
      const timer = window.setTimeout(() => {
        if (mounted) setError("Supabase browser configuration is missing.");
      }, 0);
      return () => {
        mounted = false;
        window.clearTimeout(timer);
      };
    }

    const browserSupabase = supabase;

    async function loadSession() {
      const consumedSession = await consumeSupabaseImplicitSessionFromUrl(browserSupabase);
      const { data } = consumedSession
        ? { data: { session: consumedSession } }
        : await browserSupabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
    }

    void loadSession();

    const {
      data: { subscription },
    } = browserSupabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReadiness();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadReadiness]);

  useEffect(() => {
    if (
      !shouldAutoRefreshEbayReadiness(
        readiness,
        autoRefreshAttemptedRef.current,
      )
    ) {
      return;
    }

    autoRefreshAttemptedRef.current = true;
    void refreshReadiness();
  }, [readiness, refreshReadiness]);

  const missing = new Set(readiness?.missing ?? ebayReadinessItems);
  const connected = Boolean(readiness?.connected);
  const ready = Boolean(readiness?.ready);
  const environment = readiness?.environment ?? null;
  const labels = ebayMarketplaceLabels(environment);
  const setupMessage = getEbaySetupMessage(readiness);
  const actionModel = getEbayActionModel(readiness, labels.connect);
  const offerLocationSetup = shouldOfferEbayLocationSetup(readiness);
  const locationFormValid =
    locationForm.name.trim().length > 0 &&
    locationForm.addressLine1.trim().length > 0 &&
    locationForm.city.trim().length > 0 &&
    locationForm.stateOrProvince.trim().length >= 2 &&
    /^\d{5}(-\d{4})?$/.test(locationForm.postalCode.trim());
  const statusLabel = readiness?.reconnectRequired
    ? "Connection expired, reconnect your eBay account"
    : !connected
      ? "Not connected"
      : !ready
        ? "Connected, setup incomplete"
        : environment === "production"
          ? "Connected, account ready (publishing not enabled yet)"
          : "Connected, ready for sandbox publish";

  return (
    <>
      <Topbar crumbs={["Settings", "Marketplaces"]} />
      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Marketplaces<em>.</em>
            </h1>
            <p className="t-small muted" style={{ marginTop: 4 }}>
              {labels.heading}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StockXConnectionCard accessToken={session?.access_token ?? null} />
          <EtsyConnectionCard accessToken={session?.access_token ?? null} />

          {/* eBay */}
          <section className="card">
            {/* Header row */}
            <div className="card__head" style={{ flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "var(--r-3)",
                    background: connected ? "var(--status-ready-bg)" : "var(--surface-sunk)",
                    color: connected ? "var(--status-ready-ink)" : "var(--ink-3)",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    border: "1px solid var(--line)",
                  }}
                >
                  <ShieldCheck size={22} aria-hidden="true" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{labels.account}</h2>
                  <p className="t-small muted" style={{ margin: 0 }}>{statusLabel}</p>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0 }}>
                {actionModel.showPrimaryConnect && (
                  <button
                    type="button"
                    onClick={connectEbay}
                    disabled={!session || actionState === "loading"}
                    className="btn btn--primary"
                  >
                    <Plug size={14} aria-hidden="true" />
                    {actionModel.primaryConnectLabel}
                  </button>
                )}
                {actionModel.showSecondaryReconnect && (
                  <button
                    type="button"
                    onClick={connectEbay}
                    disabled={!session || actionState === "loading"}
                    className="btn btn--secondary"
                  >
                    <Plug size={14} aria-hidden="true" />
                    {actionModel.secondaryReconnectLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={refreshReadiness}
                  disabled={!connected || actionState === "loading"}
                  className="btn btn--secondary"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={disconnectEbay}
                  disabled={!connected || actionState === "loading"}
                  className="btn btn--ghost"
                >
                  <Unplug size={14} aria-hidden="true" />
                  Disconnect
                </button>
              </div>
            </div>

            {/* Setup incomplete banner */}
            {connected && !ready && (
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
                <div className="banner banner--warn">
                  <div style={{ minWidth: 0 }}>
                    <p className="banner__title" style={{ margin: 0 }}>
                      {setupMessage.heading}
                    </p>
                    <p className="banner__desc" style={{ margin: "4px 0 0" }}>
                      {setupMessage.body}
                    </p>
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 12 }}>
                      <a
                        href="https://www.ebay.com/sh/buspolicy"
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}
                      >
                        Open eBay business policies
                      </a>
                      <a
                        href="https://www.ebay.com/sh/ovw"
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}
                      >
                        Open Seller Hub
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Inventory location form */}
            {offerLocationSetup && (
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
                <h3 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 500 }}>
                  Create your ship-from inventory location
                </h3>
                <p className="t-small muted" style={{ margin: "0 0 14px" }}>
                  eBay has no Seller Hub page for Inventory API locations, so Sello creates one
                  for you. Enter the address your items ship from; it is sent only to eBay.
                </p>
                <form
                  className="form-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createInventoryLocation();
                  }}
                >
                  {(
                    [
                      ["name", "Location name", "Default location", true],
                      ["addressLine1", "Address line 1", "123 Main St", true],
                      ["addressLine2", "Address line 2 (optional)", "Apt 4", false],
                      ["city", "City", "San Francisco", true],
                      ["stateOrProvince", "State", "CA", true],
                      ["postalCode", "ZIP code", "94103", true],
                      ["phone", "Phone (optional)", "415-555-0100", false],
                    ] as const
                  ).map(([field, label, placeholder, required]) => (
                    <label key={field} className="field">
                      <span className="field__label">{label}</span>
                      <input
                        type="text"
                        required={required}
                        value={locationForm[field]}
                        placeholder={placeholder}
                        onChange={(e) =>
                          setLocationForm((prev) => ({
                            ...prev,
                            [field]: e.target.value,
                          }))
                        }
                        className="input"
                      />
                    </label>
                  ))}
                  <label className="field">
                    <span className="field__label">Country</span>
                    <input
                      type="text"
                      value="US"
                      disabled
                      className="input"
                      style={{ opacity: 0.5 }}
                    />
                  </label>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button
                      type="submit"
                      disabled={!locationFormValid || actionState === "loading"}
                      className="btn btn--primary"
                    >
                      Create inventory location
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Readiness checklist */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 10,
                padding: "16px 20px",
              }}
              className="readiness-grid"
            >
              {ebayReadinessItems.map((item) => {
                const ok = item === "oauth_connection" ? connected : !missing.has(item);
                const Icon = ok ? CheckCircle2 : XCircle;

                return (
                  <div
                    key={item}
                    style={{
                      borderRadius: "var(--r-3)",
                      border: "1px solid var(--line)",
                      background: "var(--surface-sunk)",
                      padding: "var(--s-4)",
                    }}
                  >
                    <Icon
                      size={18}
                      style={{ color: ok ? "var(--positive)" : "var(--ink-4)" }}
                      aria-hidden="true"
                    />
                    <p style={{ margin: "10px 0 2px", fontSize: 12.5, fontWeight: 500 }}>
                      {ebayReadinessLabels[item]}
                    </p>
                    <p className="t-small muted" style={{ margin: 0 }}>
                      {ok ? "Ready" : "Missing"}
                    </p>
                    {!ok && (
                      <p
                        className="t-small muted"
                        style={{ margin: "8px 0 0", lineHeight: 1.5 }}
                      >
                        {ebayReadinessHelp[item as EbayReadinessItem]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Syncing indicator */}
            {(loadState === "loading" || actionState === "loading") && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderTop: "1px solid var(--line)",
                  padding: "10px 20px",
                }}
                className="t-small muted"
              >
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                Syncing eBay state
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                style={{ borderTop: "1px solid var(--line)", padding: "10px 20px" }}
                className="t-small danger"
              >
                Error: {error}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
